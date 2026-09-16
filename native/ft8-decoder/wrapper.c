// Emscripten wrapper around kgoba/ft8_lib's decode pipeline (vendored in ./ft8_lib,
// commit 9fec6ca39886edbf96f4f5e71edc76da5074e871, MIT license).
// Decode-loop structure adapted from e04/ft8js's src/decode.c (MIT license), with:
//   - a scalar-only FFI surface (no struct-by-value args) so cwrap marshalling is unambiguous,
//   - depth (candidate count / LDPC iterations) made runtime-configurable instead of fixed,
//   - bounds-checked output buffer writes instead of unbounded strcat.
#include <stdlib.h>
#include <string.h>
#include <stdio.h>
#include <math.h>

#include <ft8/decode.h>
#include <ft8/message.h>
#include <ft8/constants.h>
#include <common/monitor.h>

#define FT8_SAMPLE_RATE 12000
#define FT8_MAX_CANDIDATES_CAP 400
#define FT8_MAX_DECODED_MESSAGES 50
#define FT8_CALLSIGN_HASHTABLE_SIZE 256
#define FT8_MIN_SCORE 1
#define FT8_TIME_OSR 2
#define FT8_FREQ_OSR 2

// Empirically-fit additive offset (see native/ft8-decoder/tools/README.md's
// calibration procedure) that converts our raw Costas-tone-power-vs-noise-floor
// ratio into a figure matching WSJT-X's displayed SNR. WSJT-X's own equivalent
// constants (-27.0 dB, a 2.6e6 scale factor in ft8b.f90) do NOT transfer here —
// they're calibrated to WSJT-X's own internal FFT/window normalization, which
// differs from ours (monitor.c's fft_norm, our own window function, kiss_fft's
// scaling). This constant is ours alone, fit against real WSJT-X output.
// Fit 2026-09-16 against 6 synthetic AWGN test signals (-16..+4 dB target
// SNR) decoded by both this estimator and retail WSJT-X — see
// native/ft8-decoder/tools/README.md for the full procedure and raw data.
// Residuals across that range: -38.2, -36.3, -35.3, -35.6, -35.7, -35.0 dB;
// mean -36.0. A 0-noise reference signal was excluded from the fit (its
// residual, -97.0 dB, reflects the percentile floor measuring numerical/FFT
// noise rather than anything a real receiver produces).
#define FT8_SNR_CALIBRATION_OFFSET_DB -36.0f

static monitor_t g_mon;
static int g_max_candidates = 200;
static int g_ldpc_iterations = 25;

static struct
{
    char callsign[12];
    uint32_t hash;
} g_callsign_hashtable[FT8_CALLSIGN_HASHTABLE_SIZE];

static void hashtable_init(void)
{
    memset(g_callsign_hashtable, 0, sizeof(g_callsign_hashtable));
}

// Ages out callsigns not seen in the last `max_age` decode passes so the table
// doesn't fill up with stations that are no longer on the air.
static void hashtable_cleanup(uint8_t max_age)
{
    for (int i = 0; i < FT8_CALLSIGN_HASHTABLE_SIZE; ++i)
    {
        if (g_callsign_hashtable[i].callsign[0] == '\0')
            continue;
        uint8_t age = (uint8_t)(g_callsign_hashtable[i].hash >> 24);
        if (age > max_age)
        {
            g_callsign_hashtable[i].callsign[0] = '\0';
            g_callsign_hashtable[i].hash = 0;
        }
        else
        {
            g_callsign_hashtable[i].hash = (((uint32_t)age + 1u) << 24) | (g_callsign_hashtable[i].hash & 0x3FFFFFu);
        }
    }
}

static void hashtable_add(const char* callsign, uint32_t hash)
{
    uint16_t hash10 = (hash >> 12) & 0x3FFu;
    int idx = (hash10 * 23) % FT8_CALLSIGN_HASHTABLE_SIZE;
    while (g_callsign_hashtable[idx].callsign[0] != '\0')
    {
        bool same = ((g_callsign_hashtable[idx].hash & 0x3FFFFFu) == hash) &&
                    (0 == strcmp(g_callsign_hashtable[idx].callsign, callsign));
        if (same)
            return;
        idx = (idx + 1) % FT8_CALLSIGN_HASHTABLE_SIZE;
    }
    strncpy(g_callsign_hashtable[idx].callsign, callsign, 11);
    g_callsign_hashtable[idx].callsign[11] = '\0';
    g_callsign_hashtable[idx].hash = hash;
}

static bool hashtable_lookup(ftx_callsign_hash_type_t hash_type, uint32_t hash, char* callsign)
{
    uint8_t hash_shift = (hash_type == FTX_CALLSIGN_HASH_10_BITS) ? 12 : (hash_type == FTX_CALLSIGN_HASH_12_BITS ? 10 : 0);
    uint16_t hash10 = (hash >> (12 - hash_shift)) & 0x3FFu;
    int idx = (hash10 * 23) % FT8_CALLSIGN_HASHTABLE_SIZE;
    while (g_callsign_hashtable[idx].callsign[0] != '\0')
    {
        if (((g_callsign_hashtable[idx].hash & 0x3FFFFFu) >> hash_shift) == hash)
        {
            strcpy(callsign, g_callsign_hashtable[idx].callsign);
            return true;
        }
        idx = (idx + 1) % FT8_CALLSIGN_HASHTABLE_SIZE;
    }
    callsign[0] = '\0';
    return false;
}

static ftx_callsign_hash_interface_t g_hash_if = {
    .lookup_hash = hashtable_lookup,
    .save_hash = hashtable_add
};

int ft8_init(void)
{
    monitor_config_t cfg = {
        .f_min = 200,
        .f_max = 3000,
        .sample_rate = FT8_SAMPLE_RATE,
        .time_osr = FT8_TIME_OSR,
        .freq_osr = FT8_FREQ_OSR,
        .protocol = FTX_PROTOCOL_FT8
    };
    hashtable_init();
    monitor_init(&g_mon, &cfg);
    return 0;
}

void ft8_configure(int max_candidates, int ldpc_iterations)
{
    if (max_candidates < 1)
        max_candidates = 1;
    if (max_candidates > FT8_MAX_CANDIDATES_CAP)
        max_candidates = FT8_MAX_CANDIDATES_CAP;
    g_max_candidates = max_candidates;
    g_ldpc_iterations = ldpc_iterations;
}

// Appends "snr,dt,freq_hz,message\n" for one decode to `results`, honoring `capacity`.
// Returns false (and leaves `*used` unchanged) if the line wouldn't fit.
static bool append_result(char* results, int capacity, int* used, float snr, float time_sec, float freq_hz, const char* text)
{
    int remaining = capacity - *used;
    if (remaining <= 0)
        return false;
    int n = snprintf(results + *used, (size_t)remaining, "%.1f,%.2f,%.0f,%s\n", snr, time_sec, freq_hz, text);
    if (n < 0 || n >= remaining)
        return false;
    *used += n;
    return true;
}

// Signal power (dB) averaged, in the linear domain, across the 21 Costas
// sync-tone positions — always known regardless of the decoded message
// content, unlike the 58 data symbols' true tones (which would need
// re-encoding the decoded payload via ft8_encode(), not currently linked
// into this build). Mirrors decode.c's own (static, unexported)
// get_cand_mag()/ft8_sync_score() indexing exactly, but reads the magnitude
// at each expected tone bin directly instead of a neighbor-difference score.
static float costas_signal_power_db(const ftx_waterfall_t* wf, const ftx_candidate_t* cand)
{
    int offset = cand->time_offset;
    offset = (offset * wf->time_osr) + cand->time_sub;
    offset = (offset * wf->freq_osr) + cand->freq_sub;
    offset = (offset * wf->num_bins) + cand->freq_offset;
    const WF_ELEM_T* mag_cand = wf->mag + offset;

    double sum_power = 0.0;
    int count = 0;
    for (int m = 0; m < FT8_NUM_SYNC; ++m)
    {
        for (int k = 0; k < FT8_LENGTH_SYNC; ++k)
        {
            int block = (FT8_SYNC_OFFSET * m) + k;
            int block_abs = cand->time_offset + block;
            if (block_abs < 0 || block_abs >= wf->num_blocks)
                continue;
            const WF_ELEM_T* p8 = mag_cand + (block * wf->block_stride);
            int sm = kFT8_Costas_pattern[k];
            float db = WF_ELEM_MAG(p8[sm]);
            sum_power += pow(10.0, db / 10.0);
            ++count;
        }
    }
    if (count == 0)
        return -999.0f;
    return (float)(10.0 * log10(sum_power / count));
}

// Robust noise floor (dB): the 10th percentile of the whole current
// waterfall's dB-power spectrum. wf->mag values are already quantized dB
// power (see common/monitor.c: db = 10*log10(mag_squared)), so a plain
// 256-bucket histogram gives an O(n) percentile with no sorting needed.
// Simplified from WSJT-X's baseline.f90, which fits a 10-segment polynomial
// across the passband instead of one global percentile — see
// native/ft8-decoder/README.md for why that's an acceptable first cut here.
static float noise_floor_db(const ftx_waterfall_t* wf)
{
    long total = (long)wf->num_blocks * wf->block_stride;
    if (total <= 0)
        return -999.0f;
    long histogram[256] = { 0 };
    for (long i = 0; i < total; ++i)
        histogram[wf->mag[i]]++;
    long target = (long)(total * 0.10);
    long cum = 0;
    int p10_bin = 255;
    for (int b = 0; b < 256; ++b)
    {
        cum += histogram[b];
        if (cum >= target)
        {
            p10_bin = b;
            break;
        }
    }
    return WF_ELEM_MAG(p10_bin);
}

int ft8_exec_decode(const float* signal, int num_samples, char* results, int results_capacity)
{
    for (int pos = 0; pos + g_mon.block_size <= num_samples; pos += g_mon.block_size)
        monitor_process(&g_mon, signal + pos);

    const ftx_waterfall_t* wf = &g_mon.wf;
    ftx_candidate_t candidates[FT8_MAX_CANDIDATES_CAP];
    int num_candidates = ftx_find_candidates(wf, g_max_candidates, candidates, FT8_MIN_SCORE);

    int num_decoded = 0;
    ftx_message_t decoded[FT8_MAX_DECODED_MESSAGES];
    ftx_message_t* decoded_hashtable[FT8_MAX_DECODED_MESSAGES];
    for (int i = 0; i < FT8_MAX_DECODED_MESSAGES; ++i)
        decoded_hashtable[i] = NULL;

    if (results_capacity > 0)
        results[0] = '\0';
    int used = 0;

    for (int idx = 0; idx < num_candidates; ++idx)
    {
        const ftx_candidate_t* cand = &candidates[idx];
        float freq_hz = (g_mon.min_bin + cand->freq_offset + (float)cand->freq_sub / wf->freq_osr) / g_mon.symbol_period;
        float time_sec = (cand->time_offset + (float)cand->time_sub / wf->time_osr) * g_mon.symbol_period;

        ftx_message_t message;
        ftx_decode_status_t status;
        if (!ftx_decode_candidate(wf, cand, g_ldpc_iterations, &message, &status))
            continue;

        int hash_idx = message.hash % FT8_MAX_DECODED_MESSAGES;
        bool found_empty = false;
        bool found_duplicate = false;
        do
        {
            if (decoded_hashtable[hash_idx] == NULL)
                found_empty = true;
            else if (decoded_hashtable[hash_idx]->hash == message.hash &&
                     0 == memcmp(decoded_hashtable[hash_idx]->payload, message.payload, sizeof(message.payload)))
                found_duplicate = true;
            else
                hash_idx = (hash_idx + 1) % FT8_MAX_DECODED_MESSAGES;
        } while (!found_empty && !found_duplicate);

        if (!found_empty)
            continue;

        memcpy(&decoded[hash_idx], &message, sizeof(message));
        decoded_hashtable[hash_idx] = &decoded[hash_idx];
        ++num_decoded;

        char text[FTX_MAX_MESSAGE_LENGTH];
        ftx_message_offsets_t offsets;
        if (ftx_message_decode(&message, &g_hash_if, text, &offsets) != FTX_MESSAGE_RC_OK)
            continue;

        float sig_db = costas_signal_power_db(wf, cand);
        float noise_db = noise_floor_db(wf);
        float snr = sig_db - noise_db + FT8_SNR_CALIBRATION_OFFSET_DB;
        // Matches WSJT-X's own -24 dB display floor (ft8b.f90: "if(xsnr .lt.
        // -24.0) xsnr=-24.0"). The +20 dB ceiling is ours: our calibration
        // was fit against a realistic AWGN range (-16..+4 dB) and diverges
        // badly outside it (see the excluded 0-noise reference case in the
        // FT8_SNR_CALIBRATION_OFFSET_DB comment above) — clamp rather than
        // display a physically-meaningless value for a very strong signal.
        if (snr < -24.0f) snr = -24.0f;
        if (snr > 20.0f) snr = 20.0f;
        append_result(results, results_capacity, &used, snr, time_sec, freq_hz, text);
    }

    hashtable_cleanup(10);
    monitor_reset(&g_mon);
    return num_decoded;
}

// Generates a 15-second, 12kHz mono WAV containing one encoded FT8 message
// plus calibrated additive white Gaussian noise (AWGN) at a target
// SNR(2500Hz) — the same dB convention WSJT-X reports (see native/ft8-decoder's
// SNR calibration notes). Waveform synthesis (GFSK pulse shaping) is adapted
// from kgoba/ft8_lib's own demo/gen_ft8.c (MIT license, same as the vendored
// library); the AWGN calibration step is new.
//
// Usage: gen_test_signal MESSAGE WAV_FILE FREQUENCY_HZ SNR_DB [SEED]
//   SNR_DB: target SNR in the 2500Hz reference bandwidth (WSJT-X convention).
//           Pass a large value (e.g. 99) for an effectively clean/noise-free signal.
//   SEED:   RNG seed for reproducible noise (default 42).
#include <stdlib.h>
#include <string.h>
#include <stdio.h>
#include <math.h>
#include <stdbool.h>

#include "common/wave.h"
#include "ft8/message.h"
#include "ft8/encode.h"
#include "ft8/constants.h"

#define FT8_SYMBOL_BT 2.0f
#define GFSK_CONST_K 5.336446f // pi * sqrt(2 / log(2))

// WSJT-X's reported SNR is calibrated to a 2500 Hz reference bandwidth even
// though FT8's actual occupied/decode bandwidth is much narrower. We generate
// white noise across the full Nyquist range (0..sample_rate/2) and rely on
// its flat power spectral density to derive how much total noise power
// yields a given power specifically within any 2500 Hz slice of that range.
#define SNR_REFERENCE_BANDWIDTH_HZ 2500.0f

void gfsk_pulse(int n_spsym, float symbol_bt, float* pulse)
{
    for (int i = 0; i < 3 * n_spsym; ++i)
    {
        float t = i / (float)n_spsym - 1.5f;
        float arg1 = GFSK_CONST_K * symbol_bt * (t + 0.5f);
        float arg2 = GFSK_CONST_K * symbol_bt * (t - 0.5f);
        pulse[i] = (erff(arg1) - erff(arg2)) / 2;
    }
}

void synth_gfsk(const uint8_t* symbols, int n_sym, float f0, float symbol_bt, float symbol_period, int signal_rate, float* signal)
{
    int n_spsym = (int)(0.5f + signal_rate * symbol_period);
    int n_wave = n_sym * n_spsym;
    float hmod = 1.0f;

    float dphi_peak = 2 * M_PI * hmod / n_spsym;
    float dphi[n_wave + 2 * n_spsym];
    for (int i = 0; i < n_wave + 2 * n_spsym; ++i)
        dphi[i] = 2 * M_PI * f0 / signal_rate;

    float pulse[3 * n_spsym];
    gfsk_pulse(n_spsym, symbol_bt, pulse);

    for (int i = 0; i < n_sym; ++i)
    {
        int ib = i * n_spsym;
        for (int j = 0; j < 3 * n_spsym; ++j)
            dphi[j + ib] += dphi_peak * symbols[i] * pulse[j];
    }

    for (int j = 0; j < 2 * n_spsym; ++j)
    {
        dphi[j] += dphi_peak * pulse[j + n_spsym] * symbols[0];
        dphi[j + n_sym * n_spsym] += dphi_peak * pulse[j] * symbols[n_sym - 1];
    }

    float phi = 0;
    for (int k = 0; k < n_wave; ++k)
    {
        signal[k] = sinf(phi);
        phi = fmodf(phi + dphi[k + n_spsym], 2 * M_PI);
    }

    int n_ramp = n_spsym / 8;
    for (int i = 0; i < n_ramp; ++i)
    {
        float env = (1 - cosf(2 * M_PI * i / (2 * n_ramp))) / 2;
        signal[i] *= env;
        signal[n_wave - 1 - i] *= env;
    }
}

// Box-Muller transform using a seeded, reproducible LCG (not rand(), so
// results are stable across platforms/libc versions).
static uint32_t rng_state;
static float rng_uniform(void)
{
    rng_state = rng_state * 1664525u + 1013904223u;
    return (rng_state >> 8) / (float)(1u << 24); // (0, 1)
}
static float rng_gaussian(void)
{
    float u1 = rng_uniform();
    float u2 = rng_uniform();
    if (u1 < 1e-9f) u1 = 1e-9f;
    return sqrtf(-2.0f * logf(u1)) * cosf(2.0f * M_PI * u2);
}

int main(int argc, char** argv)
{
    if (argc < 5)
    {
        fprintf(stderr, "Usage: gen_test_signal MESSAGE WAV_FILE FREQUENCY_HZ SNR_DB [SEED]\n");
        return -1;
    }
    const char* message = argv[1];
    const char* wav_path = argv[2];
    float frequency = atof(argv[3]);
    float target_snr_db = atof(argv[4]);
    rng_state = (argc > 5) ? (uint32_t)atoi(argv[5]) : 42u;

    ftx_message_t msg;
    ftx_message_rc_t rc = ftx_message_encode(&msg, NULL, message);
    if (rc != FTX_MESSAGE_RC_OK)
    {
        fprintf(stderr, "Cannot parse message! RC = %d\n", (int)rc);
        return -2;
    }

    int num_tones = FT8_NN;
    float symbol_period = FT8_SYMBOL_PERIOD;
    float symbol_bt = FT8_SYMBOL_BT;
    float slot_time = FT8_SLOT_TIME;

    uint8_t tones[FT8_NN];
    ft8_encode(msg.payload, tones);

    int sample_rate = 12000;
    int num_samples = (int)(0.5f + num_tones * symbol_period * sample_rate);
    int num_silence = (int)(slot_time * sample_rate - num_samples) / 2;
    int num_total_samples = num_silence + num_samples + num_silence;

    float* signal = malloc(sizeof(float) * num_total_samples);
    for (int i = 0; i < num_silence; i++)
    {
        signal[i] = 0;
        signal[i + num_samples + num_silence] = 0;
    }
    synth_gfsk(tones, num_tones, frequency, symbol_bt, symbol_period, sample_rate, signal + num_silence);

    // Measure actual signal power over the active (tone) portion only.
    double sig_power = 0;
    for (int i = 0; i < num_samples; i++)
        sig_power += (double)signal[num_silence + i] * signal[num_silence + i];
    sig_power /= num_samples;

    // Derive AWGN variance: white noise power splits uniformly across
    // [0, Nyquist], so power-in-2500Hz = sigma^2 * (2500 / nyquist).
    // Solve for sigma^2 given the target SNR(2500Hz) = sig_power / power-in-2500Hz.
    float nyquist = sample_rate / 2.0f;
    double noise_power_2500 = sig_power / pow(10.0, target_snr_db / 10.0);
    double sigma2 = noise_power_2500 * (nyquist / SNR_REFERENCE_BANDWIDTH_HZ);
    double sigma = sqrt(sigma2);

    for (int i = 0; i < num_total_samples; i++)
        signal[i] += (float)(sigma * rng_gaussian());

    // At low target SNR, sigma can be many times the signal's unit
    // amplitude — save_wav() clamps to [-1, 1] before quantizing, and
    // clipping would distort the Gaussian noise into clipped noise,
    // corrupting exactly the low-SNR files this tool exists to produce.
    // Scale the whole (signal+noise) mixture down uniformly so it fits
    // with headroom; this preserves the SNR ratio exactly since both
    // components are scaled together.
    float peak = 0;
    for (int i = 0; i < num_total_samples; i++)
    {
        float a = fabsf(signal[i]);
        if (a > peak) peak = a;
    }
    const float headroom = 0.98f;
    if (peak > headroom)
    {
        float scale = headroom / peak;
        for (int i = 0; i < num_total_samples; i++)
            signal[i] *= scale;
        fprintf(stderr, "Peak %.3f exceeded headroom; scaled mixture by %.6f to avoid clipping\n", peak, scale);
    }

    save_wav(signal, num_total_samples, sample_rate, wav_path);

    fprintf(stderr, "Message: \"%s\"  Freq: %.1f Hz  Target SNR(2500Hz): %.1f dB\n", message, frequency, target_snr_db);
    fprintf(stderr, "Measured signal power (active): %.6f  AWGN sigma: %.6f\n", sig_power, sigma);
    fprintf(stderr, "Wrote %d samples (%.1fs) to %s\n", num_total_samples, num_total_samples / (float)sample_rate, wav_path);

    free(signal);
    return 0;
}

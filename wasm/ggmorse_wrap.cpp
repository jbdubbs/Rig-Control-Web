#include "ggmorse/ggmorse.h"
#include <emscripten.h>
#include <algorithm>
#include <cstring>
#include <vector>

static GGMorse* g_instance = nullptr;

// Ring buffer for incoming F32 samples
static std::vector<float> g_buf;
static size_t g_readPos = 0;

// Output state
static char  g_resultBuf[4096];
static int   g_resultLen = 0;
static float g_pitch = 0.0f;
static float g_speed = 0.0f;

extern "C" {

EMSCRIPTEN_KEEPALIVE
void ggmorse_init() {
    delete g_instance;

    GGMorse::Parameters p = GGMorse::getDefaultParameters();
    p.sampleRateInp   = 48000.0f;
    p.sampleRateOut   = 48000.0f;
    p.samplesPerFrame = GGMorse::kDefaultSamplesPerFrame; // 128
    p.sampleFormatInp = GGMORSE_SAMPLE_FORMAT_F32;
    p.sampleFormatOut = GGMORSE_SAMPLE_FORMAT_F32;

    g_instance  = new GGMorse(p);

    // Map prosigns to reserved single-byte tokens so they survive the char
    // interface and can be expanded to readable strings on the JS side.
    // Sequences that conflict with existing ggMorse punctuation (AR=+, AS=&,
    // BT==) are overridden here so prosigns take priority over those characters.
    g_instance->setCharacter("01010",    '\x01'); // <AR>  .-.-. (overrides '+')
    g_instance->setCharacter("000101",   '\x02'); // <SK>  ...-.-
    g_instance->setCharacter("10101",    '\x03'); // <KA>  -.-.-
    g_instance->setCharacter("01000",    '\x04'); // <AS>  .-... (overrides '&')
    g_instance->setCharacter("10001",    '\x05'); // <BT>  -...- (overrides '=')
    g_instance->setCharacter("00000000", '\x06'); // <HH>  ........

    g_buf.clear();
    g_readPos   = 0;
    g_resultLen = 0;
    g_pitch     = 0.0f;
    g_speed     = 0.0f;
}

// Push F32 samples (48 kHz mono) into the ring buffer.
// Called from JS with a WASM heap pointer + sample count.
EMSCRIPTEN_KEEPALIVE
void ggmorse_queue_samples(const float* samples, int n) {
    // Compact buffer once the read cursor has advanced far enough
    if (g_readPos > 8192) {
        g_buf.erase(g_buf.begin(), g_buf.begin() + (int)g_readPos);
        g_readPos = 0;
    }
    g_buf.insert(g_buf.end(), samples, samples + n);
}

// Run the decoder against all queued samples.
// Returns number of newly decoded characters (0 if none yet).
EMSCRIPTEN_KEEPALIVE
int ggmorse_decode() {
    if (!g_instance) return 0;
    g_resultLen = 0;

    // Pull-model callback: called by GGMorse::decode() each time it needs
    // another frame of audio (1536 F32 samples at 48 kHz = one 128-sample
    // 4 kHz frame after the 12x simple downsample).
    // Return exactly nMaxBytes or 0; partial amounts cause a decode error.
    g_instance->decode([](void* data, uint32_t nMaxBytes) -> uint32_t {
        size_t avail = (g_buf.size() - g_readPos) * sizeof(float);
        if (avail < nMaxBytes) return 0;
        memcpy(data, g_buf.data() + g_readPos, nMaxBytes);
        g_readPos += nMaxBytes / sizeof(float);
        return nMaxBytes;
    });

    GGMorse::TxRx rx;
    int n = g_instance->takeRxData(rx);
    if (n > 0) {
        int copy = std::min(n, (int)sizeof(g_resultBuf) - 1);
        memcpy(g_resultBuf, rx.data(), copy);
        g_resultBuf[copy] = '\0';
        g_resultLen = copy;
    }

    const auto& stats = g_instance->getStatistics();
    if (stats.estimatedPitch_Hz  > 0.0f) g_pitch = stats.estimatedPitch_Hz;
    if (stats.estimatedSpeed_wpm > 0.0f) g_speed = stats.estimatedSpeed_wpm;

    return g_resultLen;
}

EMSCRIPTEN_KEEPALIVE
const char* ggmorse_get_result() { return g_resultBuf; }

EMSCRIPTEN_KEEPALIVE
float ggmorse_get_pitch() { return g_pitch; }

EMSCRIPTEN_KEEPALIVE
float ggmorse_get_speed() { return g_speed; }

EMSCRIPTEN_KEEPALIVE
void ggmorse_reset() { ggmorse_init(); }

} // extern "C"

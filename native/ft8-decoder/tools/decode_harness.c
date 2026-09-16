// Standalone native decode test harness: loads a 12kHz mono WAV and runs it
// straight through our wrapper.c decode pipeline (ft8_init/ft8_configure/
// ft8_exec_decode), with zero involvement of the live audio chain (no
// PipeWire, no Opus, no browser/worker) — isolates the decoder/SNR-estimator
// question from audio-chain fidelity. Used for the WSJT-X SNR calibration
// procedure (see native/ft8-decoder/tools/README.md).
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "common/wave.h"

int ft8_init(void);
void ft8_configure(int max_candidates, int ldpc_iterations);
int ft8_exec_decode(const float* signal, int num_samples, char* results, int results_capacity);

int main(int argc, char** argv)
{
    if (argc < 2)
    {
        fprintf(stderr, "Usage: decode_harness WAV_FILE [max_candidates] [ldpc_iterations]\n");
        return 1;
    }
    const char* wav_path = argv[1];
    int max_candidates = (argc > 2) ? atoi(argv[2]) : 200;
    int ldpc_iterations = (argc > 3) ? atoi(argv[3]) : 25;

    int capacity = 20 * 12000; // generous cap, more than one 15s slot
    float* signal = malloc(sizeof(float) * capacity);
    int num_samples = capacity;
    int sample_rate = 0;
    int rc = load_wav(signal, &num_samples, &sample_rate, wav_path);
    if (rc != 0)
    {
        fprintf(stderr, "Failed to load WAV \"%s\" (rc=%d)\n", wav_path, rc);
        return 1;
    }
    if (sample_rate != 12000)
    {
        fprintf(stderr, "Expected a 12000 Hz WAV, got %d Hz\n", sample_rate);
        return 1;
    }

    ft8_init();
    ft8_configure(max_candidates, ldpc_iterations);

    char results[16384];
    int n = ft8_exec_decode(signal, num_samples, results, sizeof(results));
    printf("%s: %d decode(s)\n", wav_path, n);
    if (n > 0) printf("%s", results);

    free(signal);
    return 0;
}

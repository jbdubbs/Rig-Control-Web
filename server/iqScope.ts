import type { ServerContext } from "./context.ts";
import { vlogSpectrum, createRateLogger } from "./vlog.ts";
import { resolveDeviceId } from "./audio.ts";
import { fftComplex, fftShift, hannWindow, magnitudesDb } from "./fft.ts";

// Non-overlapping block size for the complex FFT. 2048 balances frequency
// resolution against waterfall refresh rate across the supported sample
// rates (~23fps/23Hz-per-bin at 48kHz, ~47fps/47Hz-per-bin at 96kHz).
export const IQ_FFT_SIZE = 2048;

// Fixed dB range the raw FFT magnitude is quantized into before being sent
// as a 0-255 amplitude byte (SpectrumHamlibPanel's floor/ceiling sliders
// then pick a sub-window of this range for display, same as the other two
// sources). Not a calibrated dBm reference (no absolute level is known
// without real hardware) — real captured levels have turned out to run
// hotter than originally assumed for a low-level (~50-100mV) analog G90
// I/Q signal, which is why the panel's floor/ceiling sliders were widened;
// tune these bounds and the panel's floor/ceiling defaults further once
// verified against real equipment.
export const IQ_ENCODE_MIN_DB = -100;
export const IQ_ENCODE_MAX_DB = 20;

const FRAME_BYTES = IQ_FFT_SIZE * 4; // 2 channels * 2 bytes (16-bit signed PCM)
const ENGINE_RETRY_DELAY_MS = 500;
const ENGINE_RETRY_ATTEMPTS = 6;

const iqWindow = hannWindow(IQ_FFT_SIZE);

export interface IqSpectrumFrameOptions {
  /** Interleaved 16-bit signed PCM, exactly `fftSize * 4` bytes (2 channels). */
  pcm: Buffer;
  fftSize: number;
  sampleRate: number;
  centerFreq: number;
  swapChannels: boolean;
  window: Float64Array;
}

export interface IqSpectrumFrame {
  id: number;
  name: string;
  type: "CENTER";
  length: number;
  amplitudes: number[];
  minLevel: number;
  maxLevel: number;
  centerFreq: number;
  span: number;
  lowFreq: number;
  highFreq: number;
  timestamp: number;
}

/**
 * Pure transform: interleaved stereo PCM -> a spectrum-data-shaped frame.
 * Left/right channels are treated as I/Q (swappable via `swapChannels`,
 * mirroring HDSDR's own "Swap IQ" fix for reversed-sideband I/Q sources).
 * Kept dependency-free (no naudiodon) so it's unit-testable without real
 * hardware.
 *
 * Removes each block's own I/Q DC offset (mean) before windowing — cheap USB
 * audio ADCs carry a per-channel DC bias, which is indistinguishable from a
 * real signal at 0 Hz and otherwise shows up as a strong, spurious spike at
 * the center (DC) bin after fftShift.
 */
export function buildIqSpectrumFrame(opts: IqSpectrumFrameOptions): IqSpectrumFrame {
  const { pcm, fftSize, sampleRate, centerFreq, swapChannels, window } = opts;
  if (pcm.length !== fftSize * 4) {
    throw new Error(`buildIqSpectrumFrame: expected ${fftSize * 4} bytes, got ${pcm.length}`);
  }

  const iSamples = new Float64Array(fftSize);
  const qSamples = new Float64Array(fftSize);
  let sumI = 0;
  let sumQ = 0;
  for (let i = 0; i < fftSize; i++) {
    const chA = pcm.readInt16LE(i * 4) / 32768;
    const chB = pcm.readInt16LE(i * 4 + 2) / 32768;
    const iSample = swapChannels ? chB : chA;
    const qSample = swapChannels ? chA : chB;
    iSamples[i] = iSample;
    qSamples[i] = qSample;
    sumI += iSample;
    sumQ += qSample;
  }
  const meanI = sumI / fftSize;
  const meanQ = sumQ / fftSize;

  const re = new Float64Array(fftSize);
  const im = new Float64Array(fftSize);
  for (let i = 0; i < fftSize; i++) {
    const w = window[i];
    re[i] = (iSamples[i] - meanI) * w;
    im[i] = (qSamples[i] - meanQ) * w;
  }

  fftComplex(re, im);
  const dbValues = fftShift(magnitudesDb(re, im, IQ_ENCODE_MIN_DB));

  const range = IQ_ENCODE_MAX_DB - IQ_ENCODE_MIN_DB;
  const amplitudes: number[] = new Array(fftSize);
  for (let i = 0; i < fftSize; i++) {
    const norm = Math.max(0, Math.min(1, (dbValues[i] - IQ_ENCODE_MIN_DB) / range));
    amplitudes[i] = Math.round(norm * 255);
  }

  return {
    id: 0,
    name: "Audio I/Q",
    type: "CENTER",
    length: fftSize,
    amplitudes,
    minLevel: IQ_ENCODE_MIN_DB,
    maxLevel: IQ_ENCODE_MAX_DB,
    centerFreq,
    span: sampleRate,
    lowFreq: centerFreq - sampleRate / 2,
    highFreq: centerFreq + sampleRate / 2,
    timestamp: Date.now(),
  };
}

function emitStatus(ctx: ServerContext, running: boolean, error: string | null): void {
  ctx.iqScopeRunning = running;
  ctx.iqScopeError = error;
  ctx.io.emit("iq-scope-status", { running, error });
}

/**
 * Opens a stereo naudiodon capture stream against the configured I/Q device
 * and streams `spectrum-data` frames — no child binary involved (unlike the
 * FT4222 path), naudiodon is driven directly in-process, the same way
 * server/audio.ts's radio-audio capture is.
 */
export function startIqScope(ctx: ServerContext, attempt = 0): void {
  if (ctx.iqCaptureProcess) return; // already running

  if (!ctx.isAudioEngineReady || !ctx.portAudio) {
    // initAudioEngine(ctx) is fire-and-forget at server startup — it usually
    // resolves well under a second, so a short bounded retry covers the
    // startup-autostart race without a full FT4222-style retry budget.
    if (attempt >= ENGINE_RETRY_ATTEMPTS) {
      const msg = "Audio engine not ready (naudiodon failed to load)";
      console.error(`[IQ-SCOPE] ${msg}`);
      emitStatus(ctx, false, msg);
      return;
    }
    setTimeout(() => startIqScope(ctx, attempt + 1), ENGINE_RETRY_DELAY_MS);
    return;
  }

  if (!ctx.spectrumSettings.iqAudioDevice) {
    const msg = "No I/Q capture device selected";
    vlogSpectrum(`[IQ-SCOPE] ${msg}`);
    emitStatus(ctx, false, msg);
    return;
  }

  const sampleRate = ctx.spectrumSettings.iqSampleRate || 48000;

  let deviceId: number;
  try {
    deviceId = resolveDeviceId(ctx, ctx.spectrumSettings.iqAudioDevice, "input");
  } catch (err: any) {
    const msg = `Failed to resolve I/Q device: ${err.message}`;
    console.error(`[IQ-SCOPE] ${msg}`);
    emitStatus(ctx, false, msg);
    return;
  }

  if (deviceId < 0) {
    const msg = "Configured I/Q capture device not found";
    console.error(`[IQ-SCOPE] ${msg}`);
    emitStatus(ctx, false, msg);
    return;
  }

  vlogSpectrum(`[IQ-SCOPE] Starting capture: device=${deviceId} sampleRate=${sampleRate} fftSize=${IQ_FFT_SIZE}`);

  let proc: any;
  try {
    proc = new ctx.portAudio.AudioIO({
      inOptions: {
        channelCount: 2,
        sampleFormat: ctx.portAudio.SampleFormat16Bit,
        sampleRate,
        deviceId,
        closeOnError: true,
        framesPerBuffer: 0,
        maxQueue: 10,
        highwaterMark: 256,
      },
    });
  } catch (err: any) {
    const msg = `Failed to open I/Q capture device: ${err.message}`;
    console.error(`[IQ-SCOPE] ${msg}`);
    emitStatus(ctx, false, msg);
    return;
  }

  ctx.iqCaptureProcess = proc;
  let pcmBuffer = Buffer.alloc(0);
  let frameCount = 0;
  const rateLog = createRateLogger<IqSpectrumFrame>(1000, (count, elapsed, frame) => {
    const fps = Math.round(count / elapsed);
    const range = IQ_ENCODE_MAX_DB - IQ_ENCODE_MIN_DB;
    const toDb = (amp: number) => IQ_ENCODE_MIN_DB + (amp / 255) * range;
    const hzPerBin = sampleRate / IQ_FFT_SIZE;
    const centerIdx = IQ_FFT_SIZE / 2;
    let peakIdx = 0;
    for (let i = 1; i < frame.amplitudes.length; i++) {
      if (frame.amplitudes[i] > frame.amplitudes[peakIdx]) peakIdx = i;
    }
    const peakOffsetHz = Math.round((peakIdx - centerIdx) * hzPerBin);
    vlogSpectrum(
      `[IQ-SCOPE] ${fps} fps (${frameCount} total); ` +
      `center-bin=${toDb(frame.amplitudes[centerIdx]).toFixed(1)}dB; ` +
      `peak=${toDb(frame.amplitudes[peakIdx]).toFixed(1)}dB at ${peakOffsetHz >= 0 ? "+" : ""}${peakOffsetHz}Hz from center`
    );
  });

  proc.on("data", (data: Buffer) => {
    try {
      pcmBuffer = Buffer.concat([pcmBuffer, data]);
      while (pcmBuffer.length >= FRAME_BYTES) {
        const block = pcmBuffer.subarray(0, FRAME_BYTES);
        pcmBuffer = pcmBuffer.subarray(FRAME_BYTES);
        const frame = buildIqSpectrumFrame({
          pcm: block,
          fftSize: IQ_FFT_SIZE,
          sampleRate,
          centerFreq: Number(ctx.lastStatus.frequency) || 0,
          swapChannels: ctx.spectrumSettings.iqSwapChannels,
          window: iqWindow,
        });
        ctx.io.emit("spectrum-data", frame);

        // Once/sec diagnostic: are frames actually flowing, is the center
        // (DC) bin still hot, and where does the real peak/spur sit? Mirrors
        // server/yaesuScope.ts's throttled fps log. Amplitude bytes are
        // decoded back to dB via the same linear mapping buildIqSpectrumFrame
        // used to encode them (IQ_ENCODE_MIN_DB..IQ_ENCODE_MAX_DB).
        frameCount++;
        rateLog(frame);
      }
    } catch (err: any) {
      console.error("[IQ-SCOPE] Frame build error:", err.message);
    }
  });

  proc.on("error", (err: any) => {
    const msg = `naudiodon error: ${err.message}`;
    console.error(`[IQ-SCOPE] ${msg}`);
    ctx.iqCaptureProcess = null;
    emitStatus(ctx, false, msg);
  });

  proc.start();
  emitStatus(ctx, true, null);
}

export async function stopIqScope(ctx: ServerContext): Promise<void> {
  if (ctx.iqCaptureProcess) {
    try { await ctx.iqCaptureProcess.quit(); } catch { /* already stopped */ }
    ctx.iqCaptureProcess = null;
  }
  emitStatus(ctx, false, null);
}

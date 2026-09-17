// Runs entirely off the main thread: resamples inbound 48kHz PCM to the 12kHz
// ft8_lib expects, accumulates it into UTC-aligned 15s FT8 slot windows, and
// calls into the ft8-decoder WASM module (native/ft8-decoder) to decode each one.
// Blocking this thread during a decode call is fine — that's the point of a Worker.
import { parseResultLine, type RawFt8Decode } from './ft8ResultParser';
import { shouldResyncSlot } from './ft8SlotSync';
export type { RawFt8Decode };

const FT8_SAMPLE_RATE = 12000;
const SLOT_MS = 15000;
const NUM_SAMPLES = (SLOT_MS / 1000) * FT8_SAMPLE_RATE; // 180000
const RESULTS_CAPACITY = 16384;
const DECIMATION = 4; // 48kHz -> 12kHz

const DEPTH_PRESETS: Record<string, { maxCandidates: number; ldpcIterations: number }> = {
  fast: { maxCandidates: 100, ldpcIterations: 15 },
  balanced: { maxCandidates: 200, ldpcIterations: 25 },
  deep: { maxCandidates: 400, ldpcIterations: 40 },
};

type InMessage =
  | { type: 'init'; depth: string }
  | { type: 'samples'; pcm: Float32Array }
  | { type: 'set-depth'; depth: string }
  | { type: 'set-verbose'; verbose: boolean }
  | { type: 'reset' };

type OutMessage =
  | { type: 'decodes'; decodes: RawFt8Decode[] }
  | { type: 'error'; message: string }
  | { type: 'log'; line: string };

function post(msg: OutMessage): void {
  (self as unknown as Worker).postMessage(msg);
}

let verbose = false;

// A Worker has its own isolated global scope — its `console` is not the same
// object the main thread's useConsoleCapture monkey-patches, so console.log
// here would be invisible to both DevTools' main-thread filter and the
// in-app Diagnostics log panel. Posting the line back to the main thread
// (Ft8Decoder.worker.onmessage calls console.log there) is what makes it
// reach useConsoleCapture and, from there, the unified server-relayed log.
const log = (...args: any[]) => {
  if (!verbose) return;
  const line = args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
  post({ type: 'log', line });
};

// RBJ biquad low-pass, Butterworth Q, used as an anti-alias filter before
// decimating 48kHz -> 12kHz by simply keeping every 4th filtered sample.
class LowPassFilter {
  private b0: number; private b1: number; private b2: number;
  private a1: number; private a2: number;
  private x1 = 0; private x2 = 0; private y1 = 0; private y2 = 0;

  constructor(cutoffHz: number, sampleRateHz: number, q = Math.SQRT1_2) {
    const w0 = 2 * Math.PI * cutoffHz / sampleRateHz;
    const alpha = Math.sin(w0) / (2 * q);
    const cosW0 = Math.cos(w0);
    const a0 = 1 + alpha;
    this.b0 = ((1 - cosW0) / 2) / a0;
    this.b1 = (1 - cosW0) / a0;
    this.b2 = ((1 - cosW0) / 2) / a0;
    this.a1 = (-2 * cosW0) / a0;
    this.a2 = (1 - alpha) / a0;
  }

  process(x: number): number {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x;
    this.y2 = this.y1; this.y1 = y;
    return y;
  }
}

const antiAlias = new LowPassFilter(5000, 48000);
let decimationPhase = 0;

function resampleTo12k(input: Float32Array): Float32Array {
  const out: number[] = [];
  for (let i = 0; i < input.length; i++) {
    const filtered = antiAlias.process(input[i]);
    if (decimationPhase === 0) out.push(filtered);
    decimationPhase = (decimationPhase + 1) % DECIMATION;
  }
  return Float32Array.from(out);
}

const fmtTime = (ms: number): string => new Date(ms).toISOString().slice(11, 19);

// Periodic (~1s) sample-flow summary — logging every raw chunk would be
// 50/sec and flood the console, so this batches counts between log lines.
let statsWindowStartMs = 0;
let rawSamplesInWindow = 0;
let decimatedSamplesInWindow = 0;

// Accumulation queue (decimated 12kHz samples) + the wall-clock time of its first sample.
let queue: number[] = [];
let queueStartMs: number | null = null;
let nextBoundaryMs: number | null = null;
// Wall-clock time (Date.now()) the last 'samples' message was processed at —
// used only to detect a stalled stream (see ft8SlotSync.ts), never to derive
// slot boundaries directly.
let lastChunkWallClockMs: number | null = null;

function resetSlotState(): void {
  queue = [];
  queueStartMs = null;
  nextBoundaryMs = null;
}

let mod: any = null;
let ft8Configure: ((maxCandidates: number, ldpcIterations: number) => void) | null = null;
let ft8ExecDecode: ((signalPtr: number, numSamples: number, resultsPtr: number, capacity: number) => number) | null = null;
let signalPtr = 0;
let resultsPtr = 0;
let currentDepth = 'balanced';
let pendingWindows: Array<{ samples: number[]; boundaryMs: number }> = [];

async function loadModule(): Promise<void> {
  log('[FT8-WASM] loading module...');
  // public/ft8-decoder.js is a build-time Emscripten artifact (native/ft8-decoder), served
  // as a static asset and loaded at runtime — not a TS source module, hence the suppression.
  // @ts-expect-error runtime-only public asset, no type declarations
  const { default: FT8DecoderModule } = await import(/* @vite-ignore */ '/ft8-decoder.js');
  mod = await FT8DecoderModule({ locateFile: (file: string) => `/${file}` });
  const ft8Init = mod.cwrap('ft8_init', 'number', []);
  ft8Configure = mod.cwrap('ft8_configure', null, ['number', 'number']);
  ft8ExecDecode = mod.cwrap('ft8_exec_decode', 'number', ['number', 'number', 'number', 'number']);
  ft8Init();
  applyDepth(currentDepth);
  signalPtr = mod._malloc(NUM_SAMPLES * 4);
  resultsPtr = mod._malloc(RESULTS_CAPACITY);
  log('[FT8-WASM] module ready');

  if (pendingWindows.length > 0) log(`[FT8-DECODE] replaying ${pendingWindows.length} window(s) queued while WASM was loading`);
  for (const win of pendingWindows) decodeWindow(win.samples, win.boundaryMs);
  pendingWindows = [];
}

function applyDepth(depth: string): void {
  currentDepth = depth;
  const preset = DEPTH_PRESETS[depth] ?? DEPTH_PRESETS.balanced;
  log(`[FT8-WASM] depth set to "${depth}" (maxCandidates=${preset.maxCandidates}, ldpcIterations=${preset.ldpcIterations})`);
  ft8Configure?.(preset.maxCandidates, preset.ldpcIterations);
}

// Never lets a bad window (a WASM trap, a malformed result line, anything)
// propagate out uncaught — tryExtractWindow's queue/boundary advancement
// below this call must always run, or a single failing slot wedges the
// pipeline into retrying the exact same window forever (see incident notes
// in native/ft8-decoder/README.md's troubleshooting section).
function decodeWindow(samples: number[], boundaryMs: number): void {
  if (!mod || !ft8ExecDecode) {
    log(`[FT8-DECODE] WASM not ready yet, queuing window for slot ${fmtTime(boundaryMs)} (${pendingWindows.length + 1} pending)`);
    pendingWindows.push({ samples, boundaryMs });
    return;
  }
  try {
    mod.HEAPF32.set(samples, signalPtr >>> 2);
    const numDecoded = ft8ExecDecode(signalPtr, NUM_SAMPLES, resultsPtr, RESULTS_CAPACITY);
    log(`[FT8-DECODE] slot ${fmtTime(boundaryMs)}: ft8_exec_decode returned ${numDecoded}`);
    if (numDecoded <= 0) return;
    const text = mod.UTF8ToString(resultsPtr) as string;
    const decodes = text.split('\n').filter(Boolean)
      .map((line) => {
        const parsed = parseResultLine(line, boundaryMs);
        if (!parsed) log(`[FT8-DECODE] failed to parse result line: "${line}"`);
        return parsed;
      })
      .filter((d): d is RawFt8Decode => d !== null);
    if (decodes.length > 0) post({ type: 'decodes', decodes });
  } catch (err) {
    post({ type: 'error', message: `decode failed for slot ${fmtTime(boundaryMs)}: ${String(err)}` });
  }
}

function tryExtractWindow(): void {
  if (queueStartMs === null) return;
  if (nextBoundaryMs === null) {
    nextBoundaryMs = Math.ceil(queueStartMs / SLOT_MS) * SLOT_MS;
    log(`[FT8-WINDOW] first slot boundary target: ${fmtTime(nextBoundaryMs)} (queue starts ${fmtTime(queueStartMs)})`);
  }
  const queueEndMs = queueStartMs + (queue.length / FT8_SAMPLE_RATE) * 1000;
  if (queueEndMs < nextBoundaryMs + SLOT_MS) return;

  const leadingSamples = Math.round(((nextBoundaryMs - queueStartMs) / 1000) * FT8_SAMPLE_RATE);
  if (leadingSamples < 0) {
    // Shouldn't happen, but resync defensively rather than decode a misaligned window.
    log(`[FT8-WINDOW] resync: queue start (${fmtTime(queueStartMs)}) is after target boundary (${fmtTime(nextBoundaryMs)}), recomputing`);
    nextBoundaryMs = Math.ceil(queueStartMs / SLOT_MS) * SLOT_MS;
    return;
  }
  const windowSamples = queue.slice(leadingSamples, leadingSamples + NUM_SAMPLES);
  if (windowSamples.length === NUM_SAMPLES) {
    log(`[FT8-WINDOW] extracted window for slot ${fmtTime(nextBoundaryMs)} (${windowSamples.length} samples, ${leadingSamples} leading samples dropped)`);
    decodeWindow(windowSamples, nextBoundaryMs);
  } else {
    log(`[FT8-WINDOW] slot ${fmtTime(nextBoundaryMs)} boundary reached but only ${windowSamples.length}/${NUM_SAMPLES} samples available — skipping`);
  }

  const consumed = leadingSamples + NUM_SAMPLES;
  queue = queue.slice(consumed);
  queueStartMs = queueStartMs + (consumed / FT8_SAMPLE_RATE) * 1000;
  nextBoundaryMs = nextBoundaryMs + SLOT_MS;
}

function onSamples(pcm: Float32Array): void {
  const chunkEndMs = Date.now();

  if (shouldResyncSlot(lastChunkWallClockMs, chunkEndMs)) {
    log(`[FT8-WINDOW] resync: ${chunkEndMs - lastChunkWallClockMs!}ms gap since last chunk (backgrounded/frozen tab or stalled audio) — dropping accumulated queue and re-anchoring`);
    resetSlotState();
  }
  lastChunkWallClockMs = chunkEndMs;

  const decimated = resampleTo12k(pcm);

  if (verbose) {
    rawSamplesInWindow += pcm.length;
    decimatedSamplesInWindow += decimated.length;
    if (statsWindowStartMs === 0) statsWindowStartMs = chunkEndMs;
    if (chunkEndMs - statsWindowStartMs >= 1000) {
      log(`[FT8-AUDIO] ${rawSamplesInWindow} samples/s in @48kHz -> ${decimatedSamplesInWindow} samples/s @12kHz (queue depth=${queue.length})`);
      rawSamplesInWindow = 0;
      decimatedSamplesInWindow = 0;
      statsWindowStartMs = chunkEndMs;
    }
  }

  if (decimated.length === 0) return;
  const chunkStartMs = chunkEndMs - (decimated.length / FT8_SAMPLE_RATE) * 1000;
  if (queueStartMs === null) queueStartMs = chunkStartMs;
  for (let i = 0; i < decimated.length; i++) queue.push(decimated[i]);
  tryExtractWindow();
}

// Belt-and-suspenders on top of decodeWindow's own try/catch: any *other*
// unexpected throw in this chain (resampling, windowing, a future change)
// gets reported instead of silently vanishing as an uncaught worker error
// that useConsoleCapture (main-thread only) and the Diagnostics panel can't see.
self.onmessage = (e: MessageEvent<InMessage>) => {
  const msg = e.data;
  try {
    switch (msg.type) {
      case 'init':
        currentDepth = msg.depth;
        loadModule().catch((err) => post({ type: 'error', message: String(err) }));
        break;
      case 'samples':
        onSamples(msg.pcm);
        break;
      case 'set-depth':
        applyDepth(msg.depth);
        break;
      case 'set-verbose':
        verbose = msg.verbose;
        log('[FT8-WASM] verbose logging enabled');
        break;
      case 'reset':
        log('[FT8-WASM] reset: clearing slot accumulation state');
        resetSlotState();
        break;
    }
  } catch (err) {
    post({ type: 'error', message: `unhandled error processing "${msg.type}": ${String(err)}` });
  }
};

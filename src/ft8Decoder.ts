import type { RawFt8Decode } from './workers/ft8ResultParser';

export type Ft8Depth = 'fast' | 'balanced' | 'deep';

export interface Ft8Decode extends RawFt8Decode {
  id: string;
}

type WorkerOutMessage =
  | { type: 'decodes'; decodes: RawFt8Decode[] }
  | { type: 'error'; message: string }
  | { type: 'log'; line: string };

let nextId = 0;

export class Ft8Decoder {
  private worker: Worker | null = null;
  private depth: Ft8Depth = 'balanced';
  private verbose = false;
  private readonly onDecodes: (decodes: Ft8Decode[]) => void;

  constructor(onDecodes: (decodes: Ft8Decode[]) => void) {
    this.onDecodes = onDecodes;
  }

  async init(): Promise<void> {
    if (this.worker) return;
    if (this.verbose) console.log('[FT8-MAIN] creating worker');
    const worker = new Worker(new URL('./workers/ft8Decoder.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<WorkerOutMessage>) => {
      const msg = e.data;
      if (msg.type === 'decodes') {
        if (this.verbose) console.log(`[FT8-MAIN] received ${msg.decodes.length} decode(s) from worker`);
        this.onDecodes(msg.decodes.map((d) => ({ ...d, id: `${Date.now()}-${nextId++}` })));
      } else if (msg.type === 'error') {
        console.error('[FT8-MAIN] worker error:', msg.message);
      } else if (msg.type === 'log') {
        // Relayed from the worker's own isolated global scope — logging it
        // here (main thread) is what makes it reach useConsoleCapture and,
        // from there, the in-app Diagnostics log panel.
        console.log(msg.line);
      }
    };
    // Defense-in-depth on top of the worker's own internal try/catch (which
    // covers decode/message-handling failures): this catches anything more
    // catastrophic, e.g. the worker script itself failing to load/parse.
    worker.onerror = (e: ErrorEvent) => {
      console.error('[FT8-MAIN] uncaught worker error:', e.message, `(${e.filename}:${e.lineno})`);
    };
    worker.postMessage({ type: 'init', depth: this.depth });
    worker.postMessage({ type: 'set-verbose', verbose: this.verbose });
    this.worker = worker;
  }

  processSamples(pcm: Float32Array): void {
    if (!this.worker) return;
    // Copy: the same underlying buffer is also handed to the playback worklet
    // and the CW decoder in the same audio callback, so it can't be transferred directly.
    const copy = pcm.slice();
    this.worker.postMessage({ type: 'samples', pcm: copy }, [copy.buffer]);
  }

  setDepth(depth: Ft8Depth): void {
    this.depth = depth;
    this.worker?.postMessage({ type: 'set-depth', depth });
  }

  setVerbose(verbose: boolean): void {
    this.verbose = verbose;
    this.worker?.postMessage({ type: 'set-verbose', verbose });
  }

  reset(): void {
    this.worker?.postMessage({ type: 'reset' });
  }
}

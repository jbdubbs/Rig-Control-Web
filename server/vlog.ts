const argv = process.argv;

export const ts = (): string => {
  const d = new Date();
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}.${d.getMilliseconds().toString().padStart(3, '0')}`;
};

if (argv.includes('--help')) {
  console.log(`
RigControl Web

Usage: npm run dev [-- <options>]

Debug options:
  --debug-rig        Rig communication (rigctld TCP commands, poll results)
  --debug-audio      Audio pipeline (naudiodon, Opus encode/decode, mic routing)
  --debug-video      Video relay (H.264 chunk forwarding, keyframe buffering)
  --debug-cw         CW keyer (iambic state machine, DTR/RTS key events)
  --debug-infra      Infrastructure (TLS, settings, Socket.io lifecycle)
  --debug-spectrum   Spectrum scope (Hamlib UDP multicast, FT4222 SPI frames)
  --debug-spots      Spot integration (POTA/SOTA/WWFF fetch lifecycle)
  --debug-dxcluster  DX cluster (telnet connection, login, spot line parsing)
  --debug-wsjtx      WSJTX bridge (WebSocket lifecycle, rig command relay)
  --debug-ft8        FT8 decoder (browser/worker-only — WASM load, audio flow, decode calls)
  --debug-all        Enable all debug flags
  --help             Show this help message
`);
  process.exit(0);
}

const debugAll = argv.includes('--debug-all') || process.env.DEBUG_ALL === '1';

const flag = (name: string, env: string) =>
  debugAll || argv.includes(`--debug-${name}`) || process.env[env] === '1';

export type DebugFlags = {
  rig: boolean;
  audio: boolean;
  video: boolean;
  cw: boolean;
  infra: boolean;
  spectrum: boolean;
  spots: boolean;
  dxcluster: boolean;
  wsjtx: boolean;
  // No server-side component: FT8 decoding runs entirely in the browser/worker
  // (native/ft8-decoder). Still routed through this same flag/Diagnostics-tab
  // machinery so it can be seeded via --debug-ft8/DEBUG_FT8 and toggled live,
  // consistent with every other subsystem — see src/ft8Decoder.ts and
  // src/workers/ft8Decoder.worker.ts for where it's actually consumed.
  ft8: boolean;
};

// Mutable, live source of truth for every vlog* wrapper below — seeded from
// CLI/env at startup, but toggled at runtime by the Diagnostics tab
// (server/diagnostics.ts) without requiring a restart.
export const debugFlags: DebugFlags = {
  rig: flag('rig', 'DEBUG_RIG'),
  audio: flag('audio', 'DEBUG_AUDIO'),
  video: flag('video', 'DEBUG_VIDEO'),
  cw: flag('cw', 'DEBUG_CW'),
  infra: flag('infra', 'DEBUG_INFRA'),
  spectrum: flag('spectrum', 'DEBUG_SPECTRUM'),
  spots: flag('spots', 'DEBUG_SPOTS'),
  dxcluster: flag('dxcluster', 'DEBUG_DXCLUSTER'),
  wsjtx: flag('wsjtx', 'DEBUG_WSJTX'),
  ft8: flag('ft8', 'DEBUG_FT8'),
};

export function setDebugFlag(key: keyof DebugFlags, value: boolean): void {
  debugFlags[key] = value;
}

// Shared "accumulate a count, flush a throttled log line every intervalMs" helper —
// used by the spectrum-source modules (Hamlib UDP, FT4222, Audio I/Q) for their
// fps/throughput diagnostic logging, which was previously hand-rolled separately in
// each one. Returns a tick function: call it once per event with an optional payload
// (whatever the eventual log line needs beyond the count/elapsed-time), and onFlush
// fires synchronously once intervalMs has elapsed since the last flush, with the
// count of ticks since then, the elapsed seconds, and the payload from the most
// recent tick. Callers track their own cumulative totals outside this helper, since
// that's just something a log line prints, not part of the throttling logic itself.
export function createRateLogger<T = void>(
  intervalMs: number,
  onFlush: (count: number, elapsedSeconds: number, last: T) => void
): (value: T) => void {
  let count = 0;
  let lastFlushTime = Date.now();
  let lastValue: T;
  return (value: T) => {
    count++;
    lastValue = value;
    const now = Date.now();
    if (now - lastFlushTime >= intervalMs) {
      onFlush(count, (now - lastFlushTime) / 1000, lastValue);
      count = 0;
      lastFlushTime = now;
    }
  };
}

export const vlogRig      = (...args: any[]) => { if (debugFlags.rig)      console.log(`[${ts()}]`, ...args); };
export const vlogAudio    = (...args: any[]) => { if (debugFlags.audio)    console.log(`[${ts()}]`, ...args); };
export const vlogVideo    = (...args: any[]) => { if (debugFlags.video)    console.log(`[${ts()}]`, ...args); };
export const vlogCw       = (...args: any[]) => { if (debugFlags.cw)       console.log(`[${ts()}]`, ...args); };
export const vlogInfra    = (...args: any[]) => { if (debugFlags.infra)    console.log(`[${ts()}]`, ...args); };
export const vlogSpectrum = (...args: any[]) => { if (debugFlags.spectrum) console.log(`[${ts()}]`, ...args); };
export const vlogSpots    = (...args: any[]) => { if (debugFlags.spots)    console.log(`[${ts()}]`, ...args); };
export const vlogDx       = (...args: any[]) => { if (debugFlags.dxcluster) console.log(`[${ts()}]`, ...args); };
export const vlogWsjtx   = (...args: any[]) => { if (debugFlags.wsjtx)    console.log(`[${ts()}]`, ...args); };

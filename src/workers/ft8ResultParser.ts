// Pure, side-effect-free logic split out of ft8Decoder.worker.ts specifically
// so it's unit-testable: importing the worker module itself pulls in its
// dynamic import of the /ft8-decoder.js public asset, which Vite's transform
// (including under Vitest) refuses to statically analyze outside an actual
// Worker entry point — see ft8Decoder.worker.test.ts.

export interface RawFt8Decode {
  utcTime: string;
  snr: number;
  dt: number;
  freqHz: number;
  message: string;
}

// Parses one "snr,dt,freq_hz,message" line as produced by wrapper.c's
// append_result() (native/ft8-decoder/wrapper.c).
export function parseResultLine(line: string, boundaryMs: number): RawFt8Decode | null {
  const match = /^([^,]*),([^,]*),([^,]*),(.*)$/.exec(line);
  if (!match) return null;
  const snr = parseFloat(match[1]);
  const dt = parseFloat(match[2]);
  const freqHz = parseFloat(match[3]);
  const message = match[4];
  if (!Number.isFinite(snr) || !Number.isFinite(dt) || !Number.isFinite(freqHz) || !message) return null;
  const utcTime = new Date(boundaryMs).toISOString().slice(11, 19);
  return { utcTime, snr, dt, freqHz, message };
}

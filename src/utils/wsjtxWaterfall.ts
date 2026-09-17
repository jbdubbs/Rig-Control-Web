import { SILENCE_FLOOR_DB, sanitizeDb } from "./autoLevel";

// Pure DSP helpers backing SpectrumAudioPanel's "WSJT-X" waterfall mode —
// bin-averaging (Bins/Pixel), frame-averaging (N Avg), and slope removal
// (Flatten). All math happens in power domain except flatten, which WSJT-X
// itself only applies as a display-time dB correction.

export function dbToPower(db: number): number {
  return db <= SILENCE_FLOOR_DB ? 0 : Math.pow(10, db / 10);
}

export function powerToDb(power: number): number {
  return power <= 0 ? SILENCE_FLOOR_DB : 10 * Math.log10(power);
}

// Power-domain mean of N same-length dB frames ("N Avg").
export function averagePowerFrames(frames: Float32Array[]): Float32Array {
  const len = frames[0]?.length ?? 0;
  const out = new Float32Array(len);
  if (frames.length === 0) return out;
  for (let i = 0; i < len; i++) {
    let sum = 0;
    for (let f = 0; f < frames.length; f++) sum += dbToPower(sanitizeDb(frames[f][i]));
    out[i] = powerToDb(sum / frames.length);
  }
  return out;
}

// Groups every binsPerPixel consecutive bins into one power-averaged output
// bin ("Bins/Pixel"). The final group may be shorter than binsPerPixel if
// length isn't an exact multiple — averaged over whatever it has.
export function binAveragePower(dbValues: ArrayLike<number>, length: number, binsPerPixel: number): Float32Array {
  const n = Math.max(1, Math.floor(binsPerPixel));
  const outLen = Math.max(1, Math.ceil(length / n));
  const out = new Float32Array(outLen);
  for (let o = 0; o < outLen; o++) {
    const start = o * n;
    const end = Math.min(length, start + n);
    let sum = 0;
    for (let i = start; i < end; i++) sum += dbToPower(sanitizeDb(dbValues[i]));
    out[o] = powerToDb(sum / (end - start));
  }
  return out;
}

// Least-squares linear fit of dB vs. bin index, subtracted off, with the
// pre-flatten median added back so the result stays on the same absolute dB
// scale — only the slope/tilt is removed ("Flatten": compensates for a
// sloping or uneven passband, display-only).
export function flattenLinearDetrend(dbValues: Float32Array): Float32Array {
  const n = dbValues.length;
  const out = new Float32Array(n);
  if (n < 2) {
    out.set(dbValues);
    return out;
  }

  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
  for (let i = 0; i < n; i++) {
    const y = sanitizeDb(dbValues[i]);
    sumX += i;
    sumY += y;
    sumXY += i * y;
    sumXX += i * i;
  }
  const denom = n * sumXX - sumX * sumX;
  const slope = denom === 0 ? 0 : (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;

  const sorted = Array.from(dbValues, sanitizeDb).sort((a, b) => a - b);
  const median = n % 2 === 0 ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2 : sorted[(n - 1) / 2];

  for (let i = 0; i < n; i++) {
    const trend = slope * i + intercept;
    out[i] = sanitizeDb(dbValues[i]) - trend + median;
  }
  return out;
}

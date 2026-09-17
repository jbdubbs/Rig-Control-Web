import { describe, expect, it } from 'vitest';
import { SILENCE_FLOOR_DB } from './autoLevel';
import {
  averagePowerFrames,
  binAveragePower,
  dbToPower,
  flattenLinearDetrend,
  powerToDb,
} from './wsjtxWaterfall';

describe('dbToPower / powerToDb', () => {
  it('round-trips finite dB values', () => {
    expect(powerToDb(dbToPower(-40))).toBeCloseTo(-40, 6);
    expect(powerToDb(dbToPower(0))).toBeCloseTo(0, 6);
  });

  it('maps silence-floor dB to zero power and back', () => {
    expect(dbToPower(SILENCE_FLOOR_DB)).toBe(0);
    expect(dbToPower(-Infinity)).toBe(0);
    expect(powerToDb(0)).toBe(SILENCE_FLOOR_DB);
  });
});

describe('averagePowerFrames', () => {
  it('returns the same value when averaging identical flat frames', () => {
    const frame = new Float32Array([-50, -50, -50, -50]);
    const out = averagePowerFrames([frame, frame.slice(), frame.slice()]);
    for (const v of out) expect(v).toBeCloseTo(-50, 4);
  });

  it('averages two different frames in power domain (not a simple dB mean)', () => {
    const a = new Float32Array([-40]);
    const b = new Float32Array([-60]);
    const out = averagePowerFrames([a, b]);
    // Power-domain mean of a much stronger and a much weaker bin skews
    // toward the stronger one, unlike a naive dB average (-50).
    expect(out[0]).toBeGreaterThan(-50);
    expect(out[0]).toBeLessThan(-40);
  });

  it('never produces NaN from -Infinity bins', () => {
    const a = new Float32Array([-Infinity, -30]);
    const b = new Float32Array([-30, -Infinity]);
    const out = averagePowerFrames([a, b]);
    expect(Number.isNaN(out[0])).toBe(false);
    expect(Number.isNaN(out[1])).toBe(false);
  });

  it('returns an empty array for no frames', () => {
    expect(averagePowerFrames([]).length).toBe(0);
  });
});

describe('binAveragePower', () => {
  it('groups exact multiples correctly', () => {
    const values = new Float32Array([-10, -10, -30, -30]);
    const out = binAveragePower(values, 4, 2);
    expect(out.length).toBe(2);
    expect(out[0]).toBeCloseTo(-10, 4);
    expect(out[1]).toBeCloseTo(-30, 4);
  });

  it('handles a remainder group shorter than binsPerPixel', () => {
    const values = new Float32Array([-10, -10, -10, -20]);
    const out = binAveragePower(values, 4, 3);
    expect(out.length).toBe(2);
    expect(out[0]).toBeCloseTo(-10, 4);
    expect(out[1]).toBeCloseTo(-20, 4);
  });

  it('reduces flat-noise variance versus the raw input (coarser/smoother)', () => {
    const values = new Float32Array([-40, -20, -40, -20, -40, -20, -40, -20]);
    const out = binAveragePower(values, 8, 4);
    expect(out.length).toBe(2);
    // Power-averaging two alternating -40/-20 bins lands strictly between them.
    expect(out[0]).toBeGreaterThan(-40);
    expect(out[0]).toBeLessThan(-20);
  });
});

describe('flattenLinearDetrend', () => {
  it('leaves an already-flat spectrum unchanged', () => {
    const values = new Float32Array([-50, -50, -50, -50, -50]);
    const out = flattenLinearDetrend(values);
    for (const v of out) expect(v).toBeCloseTo(-50, 4);
  });

  it('removes a known linear slope, leaving a flat result', () => {
    const values = new Float32Array([-70, -60, -50, -40, -30]);
    const out = flattenLinearDetrend(values);
    const first = out[0];
    for (const v of out) expect(v).toBeCloseTo(first, 4);
  });

  it('preserves a real peak above the flattened baseline', () => {
    const values = new Float32Array([-70, -60, -50, -40, -30]);
    values[2] = 0; // spike in the middle of an otherwise sloped floor
    const out = flattenLinearDetrend(values);
    const others = [out[0], out[1], out[3], out[4]];
    for (const v of others) expect(out[2]).toBeGreaterThan(v);
  });

  it('never produces NaN from -Infinity bins', () => {
    const values = new Float32Array([-Infinity, -50, -Infinity, -50]);
    const out = flattenLinearDetrend(values);
    for (const v of out) expect(Number.isNaN(v)).toBe(false);
  });
});

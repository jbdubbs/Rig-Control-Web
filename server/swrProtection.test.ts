// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  TUNE_NO_PTT_TIMEOUT_MS,
  TUNE_WINDOW_MAX_MS,
  advanceTuneWindow,
  evaluateSwrTrip,
  openTuneWindow,
  sanitizeSwrThreshold,
} from './swrProtection.ts';

const base = {
  swr: 5,
  keyed: true,
  tuning: false,
  enabled: true,
  threshold: 3,
  alreadyTripped: false,
  consecutive: 0,
};

describe('sanitizeSwrThreshold', () => {
  it('passes a valid value through', () => {
    expect(sanitizeSwrThreshold(3)).toBe(3);
    expect(sanitizeSwrThreshold('2.5')).toBe(2.5);
  });
  it('clamps out-of-range values', () => {
    expect(sanitizeSwrThreshold(0.5)).toBe(1.1);
    expect(sanitizeSwrThreshold(99)).toBe(10);
  });
  it('falls back for non-numeric input', () => {
    expect(sanitizeSwrThreshold('abc')).toBe(3);
    expect(sanitizeSwrThreshold(NaN)).toBe(3);
    expect(sanitizeSwrThreshold(undefined)).toBe(3);
    expect(sanitizeSwrThreshold(null)).toBe(3);
    expect(sanitizeSwrThreshold('', 2)).toBe(2);
  });
});

describe('evaluateSwrTrip', () => {
  it('needs two consecutive over-threshold samples', () => {
    const first = evaluateSwrTrip(base);
    expect(first).toEqual({ trip: false, consecutive: 1 });
    expect(evaluateSwrTrip({ ...base, consecutive: first.consecutive })).toEqual({ trip: true, consecutive: 2 });
  });
  it('a reading at or below the threshold resets the count', () => {
    expect(evaluateSwrTrip({ ...base, swr: 3, consecutive: 1 })).toEqual({ trip: false, consecutive: 0 });
    expect(evaluateSwrTrip({ ...base, swr: 1.5, consecutive: 1 })).toEqual({ trip: false, consecutive: 0 });
  });
  it('never trips inside a tune window, even at very high SWR', () => {
    expect(evaluateSwrTrip({ ...base, swr: 10, tuning: true, consecutive: 5 })).toEqual({ trip: false, consecutive: 0 });
  });
  it('never trips when disabled, unkeyed, or already tripped', () => {
    expect(evaluateSwrTrip({ ...base, enabled: false, consecutive: 5 }).trip).toBe(false);
    expect(evaluateSwrTrip({ ...base, keyed: false, consecutive: 5 }).trip).toBe(false);
    expect(evaluateSwrTrip({ ...base, alreadyTripped: true, consecutive: 5 }).trip).toBe(false);
  });
  it('ignores invalid readings (Dummy rig reports 0, NaN, negatives)', () => {
    for (const swr of [0, NaN, -1, 0.9, Infinity]) {
      expect(evaluateSwrTrip({ ...base, swr, consecutive: 5 }).trip).toBe(false);
    }
  });
});

describe('tune window', () => {
  const t0 = 1_000_000;

  it('stays open while the tune keys the rig, then closes when PTT drops', () => {
    let w = advanceTuneWindow(openTuneWindow(t0), false, t0 + 100);
    expect(w).toEqual({ startedAt: t0, seenPtt: false });
    w = advanceTuneWindow(w, true, t0 + 500);
    expect(w).toEqual({ startedAt: t0, seenPtt: true });
    w = advanceTuneWindow(w, true, t0 + 4000);
    expect(w?.seenPtt).toBe(true);
    expect(advanceTuneWindow(w, false, t0 + 6000)).toBeNull();
  });

  it('closes if the rig never keys within the no-PTT timeout', () => {
    const w = openTuneWindow(t0);
    expect(advanceTuneWindow(w, false, t0 + TUNE_NO_PTT_TIMEOUT_MS - 1)).not.toBeNull();
    expect(advanceTuneWindow(w, false, t0 + TUNE_NO_PTT_TIMEOUT_MS)).toBeNull();
  });

  it('closes at the hard cap even if the carrier is still on', () => {
    let w = advanceTuneWindow(openTuneWindow(t0), true, t0 + 100);
    expect(advanceTuneWindow(w, true, t0 + TUNE_WINDOW_MAX_MS - 1)).not.toBeNull();
    expect(advanceTuneWindow(w, true, t0 + TUNE_WINDOW_MAX_MS)).toBeNull();
  });

  it('a null window stays null', () => {
    expect(advanceTuneWindow(null, true, t0)).toBeNull();
  });

  it('after the cap closes a hung tune, normal protection trips on the next samples', () => {
    const closed = advanceTuneWindow(advanceTuneWindow(openTuneWindow(t0), true, t0 + 100), true, t0 + TUNE_WINDOW_MAX_MS);
    expect(closed).toBeNull();
    const first = evaluateSwrTrip({ ...base, tuning: closed !== null });
    expect(evaluateSwrTrip({ ...base, tuning: closed !== null, consecutive: first.consecutive }).trip).toBe(true);
  });
});

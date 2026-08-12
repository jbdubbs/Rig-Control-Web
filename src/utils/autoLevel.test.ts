import { describe, expect, it } from 'vitest';
import {
  createAutoLevelState,
  DEFAULT_AUTO_LEVEL_OPTIONS,
  ewmaStep,
  percentile,
  stepAutoLevel,
  updateCeilingDecay,
  updateCeilingRatchet,
  updateFloorHysteresis,
} from './autoLevel';

describe('percentile', () => {
  const sorted = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

  it('returns the minimum at p0', () => {
    expect(percentile(sorted, 0)).toBe(0);
  });

  it('returns the median at p50', () => {
    expect(percentile(sorted, 50)).toBe(50);
  });

  it('returns the maximum at p100', () => {
    expect(percentile(sorted, 100)).toBe(100);
  });

  it('interpolates at a non-integer index', () => {
    expect(percentile([0, 10], 25)).toBeCloseTo(2.5);
  });

  it('returns 0 for an empty array', () => {
    expect(percentile([], 50)).toBe(0);
  });

  it('returns the single value for a one-element array regardless of p', () => {
    expect(percentile([42], 0)).toBe(42);
    expect(percentile([42], 99)).toBe(42);
  });

  it('does not depend on input order', () => {
    expect(percentile([90, 0, 40, 10], 50)).toBeCloseTo(percentile([0, 10, 40, 90], 50));
  });
});

describe('ewmaStep', () => {
  it('converges toward the target over repeated calls', () => {
    let v = 0;
    for (let i = 0; i < 50; i++) {
      v = ewmaStep(v, 100, 200, 1000);
    }
    expect(v).toBeGreaterThan(95);
    expect(v).toBeLessThanOrEqual(100);
  });

  it('returns prev unchanged when dt is 0', () => {
    expect(ewmaStep(10, 100, 0, 1000)).toBe(10);
  });

  it('snaps close to the sample when dt is large relative to tau', () => {
    const v = ewmaStep(0, 100, 100000, 1000);
    expect(v).toBeGreaterThan(99.9);
  });
});

describe('updateFloorHysteresis', () => {
  const opts = DEFAULT_AUTO_LEVEL_OPTIONS;
  const start = { committedFloorDb: -85, floorDriftSinceMs: null };

  it('never commits for drift within the deadband, even sustained a long time', () => {
    // implied noise floor = -85 + 5 = -80; +/- 6dB deadband means -86..-74 is safe
    let s = start;
    let t = 0;
    for (let i = 0; i < 100; i++) {
      t += 500;
      s = updateFloorHysteresis(s, -78, t, opts);
    }
    expect(s.committedFloorDb).toBe(-85);
  });

  it('cancels the sustain timer if drift reverts before the confirm window elapses', () => {
    let s = updateFloorHysteresis(start, -50, 0, opts); // well outside deadband
    expect(s.floorDriftSinceMs).not.toBeNull();
    s = updateFloorHysteresis(s, -50, 1000, opts); // still drifting, not yet 3s
    expect(s.committedFloorDb).toBe(-85);
    s = updateFloorHysteresis(s, -80, 1500, opts); // reverts back inside deadband
    expect(s.floorDriftSinceMs).toBeNull();
    expect(s.committedFloorDb).toBe(-85);
  });

  it('commits a new floor once drift is sustained the full confirm window', () => {
    let s = updateFloorHysteresis(start, -50, 0, opts);
    s = updateFloorHysteresis(s, -50, 1500, opts);
    expect(s.committedFloorDb).toBe(-85); // not yet
    s = updateFloorHysteresis(s, -50, 3000, opts);
    expect(s.committedFloorDb).toBe(-50 - opts.floorMarginDb);
    expect(s.floorDriftSinceMs).toBeNull();
  });
});

describe('updateCeilingRatchet', () => {
  const opts = DEFAULT_AUTO_LEVEL_OPTIONS; // ceilingWindowMs=1200, ceilingHitFraction=0.4 -> needs 480ms cumulative "above" time
  const start = { committedCeilingDb: -40, ceilingAboveMs: 0, ceilingCandidatePeakDb: null };

  it('rejects a brief single-frame transient that decays away before reaching the duty-cycle threshold', () => {
    let s = updateCeilingRatchet(start, -10, 50, opts); // well above implied peak (-43), one short frame
    expect(s.ceilingCandidatePeakDb).toBe(-10);
    expect(s.ceilingAboveMs).toBe(50);
    s = updateCeilingRatchet(s, -60, 100, opts); // drops back below implied peak and decays out
    expect(s.ceilingAboveMs).toBe(0);
    expect(s.ceilingCandidatePeakDb).toBeNull();
    expect(s.committedCeilingDb).toBe(-40);
  });

  it('tolerates a brief dip mid-burst and still commits once cumulative above-time crosses the threshold', () => {
    let s = updateCeilingRatchet(start, -10, 300, opts); // above for 300ms
    expect(s.committedCeilingDb).toBe(-40); // not yet (300 < 480)
    s = updateCeilingRatchet(s, -60, 50, opts); // brief dip: decays 300 -> 250, but doesn't reset
    expect(s.ceilingAboveMs).toBe(250);
    expect(s.ceilingCandidatePeakDb).toBe(-10); // peak-so-far is remembered through the dip
    s = updateCeilingRatchet(s, -10, 300, opts); // resumes: 250 + 300 = 550 >= 480 -> commits
    expect(s.committedCeilingDb).toBe(-10 + opts.ceilingHeadroomDb);
  });

  it('never decreases the ceiling even after the trend drops for a long time', () => {
    let s = updateCeilingRatchet(start, -10, opts.ceilingWindowMs * opts.ceilingHitFraction, opts);
    const accepted = s.committedCeilingDb;
    expect(accepted).toBeGreaterThan(-40);
    s = updateCeilingRatchet(s, -150, 5000, opts);
    s = updateCeilingRatchet(s, -150, 10000, opts);
    expect(s.committedCeilingDb).toBe(accepted);
  });

  it('applies the headroom margin above the accepted peak', () => {
    const s = updateCeilingRatchet(start, -5, opts.ceilingWindowMs * opts.ceilingHitFraction, opts);
    expect(s.committedCeilingDb).toBe(-5 + opts.ceilingHeadroomDb);
  });

  it('catches a narrow single-bin peak that p99 (old default) would have missed', () => {
    // 850 bins (FT4222-sized), only 1 elevated -> under the 1% (~9 bin) bar
    // a 99th-percentile read would need, but p100 (current default) is exact.
    const bins = new Float32Array(850).fill(-90);
    bins[0] = -10;
    expect(percentile(bins, 99)).toBeLessThan(-50); // old default: misses the peak entirely
    expect(percentile(bins, opts.ceilingPercentile)).toBe(-10); // new default: exact
  });
});

describe('updateCeilingDecay', () => {
  const opts = DEFAULT_AUTO_LEVEL_OPTIONS; // ceilingDecayDeadbandDb=15, ceilingDecaySustainMs=60000
  const start = { committedCeilingDb: -40, ceilingDecaySinceMs: null }; // impliedPeak = -43

  it('never commits while the gap stays under the deadband, even sustained far past 60s', () => {
    // gapDb = -43 - (-50) = 7, under the 15dB deadband
    let s = start;
    let t = 0;
    for (let i = 0; i < 200; i++) {
      t += 1000;
      s = updateCeilingDecay(s, -50, t, opts);
    }
    expect(s.committedCeilingDb).toBe(-40);
    expect(s.ceilingDecaySinceMs).toBeNull();
  });

  it('cancels the countdown outright if the trend recovers within the deadband before 60s elapses', () => {
    let s = updateCeilingDecay(start, -70, 0, opts); // gapDb=27, starts the clock
    expect(s.ceilingDecaySinceMs).not.toBeNull();
    s = updateCeilingDecay(s, -70, 30000, opts); // still counting, well under 60s
    expect(s.committedCeilingDb).toBe(-40);
    s = updateCeilingDecay(s, -50, 31000, opts); // recovers to gapDb=7, under deadband
    expect(s.ceilingDecaySinceMs).toBeNull();
    expect(s.committedCeilingDb).toBe(-40);
  });

  it('does not commit a moment before the full 60s sustain has elapsed', () => {
    let s = updateCeilingDecay(start, -70, 0, opts);
    s = updateCeilingDecay(s, -70, 59999, opts);
    expect(s.committedCeilingDb).toBe(-40);
  });

  it('commits a strictly lower ceiling once the full 60s sustain elapses', () => {
    let s = updateCeilingDecay(start, -70, 0, opts);
    s = updateCeilingDecay(s, -70, 60000, opts);
    expect(s.committedCeilingDb).toBe(-70 + opts.ceilingHeadroomDb);
    expect(s.committedCeilingDb).toBeLessThan(-40);
    expect(s.ceilingDecaySinceMs).toBeNull();
  });
});

describe('single-look periodogram floor bias (percentile choice)', () => {
  // A single, un-averaged power-spectrum estimate is exponentially
  // distributed even when the true power is constant (2-DOF chi-squared).
  // Build a synthetic array whose empirical distribution exactly matches
  // that theoretical exponential CDF, so percentile() on it reproduces the
  // known analytic bias: 10*log10(-ln(1-p)) dB relative to the true mean
  // power. This is the effect documented in autoLevel.ts's header comment
  // and is why floorPercentile is per-source configurable.
  function syntheticSingleLookFrame(meanPowerDb: number, n = 2000): Float32Array {
    const meanPowerLinear = Math.pow(10, meanPowerDb / 10);
    const arr = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const p = (i + 0.5) / n;
      const powerLinear = -meanPowerLinear * Math.log(1 - p);
      arr[i] = 10 * Math.log10(powerLinear);
    }
    return arr;
  }

  it('p10 underestimates the true mean by ~9.8dB (the bug this fix addresses)', () => {
    const frame = syntheticSingleLookFrame(-90);
    expect(percentile(frame, 10)).toBeCloseTo(-90 - 9.8, 0);
  });

  it('p63.2 lands within ~0.2dB of the true mean (the FT4222 fix)', () => {
    const frame = syntheticSingleLookFrame(-90);
    expect(percentile(frame, 63.2)).toBeCloseTo(-90, 0);
  });
});

describe('stepAutoLevel', () => {
  function flatPlusSignal(noiseDb: number, signalDb: number, totalBins = 500, signalBins = 20): Float32Array {
    const arr = new Float32Array(totalBins).fill(noiseDb);
    for (let i = 0; i < signalBins; i++) arr[i] = signalDb;
    return arr;
  }

  it('seeds directly from the first frame with no gating', () => {
    const s = stepAutoLevel(createAutoLevelState(), flatPlusSignal(-90, -20), 0, null, null);
    expect(s.seeded).toBe(true);
    expect(s.committedFloorDb).toBeCloseTo(-90 - DEFAULT_AUTO_LEVEL_OPTIONS.floorMarginDb, 0);
    expect(s.displayFloorDb).toBe(s.committedFloorDb);
    expect(s.displayCeilingDb).toBe(s.committedCeilingDb);
  });

  it('converges floor near noiseLevel - margin and ceiling near signalPeak + headroom over time', () => {
    let s = createAutoLevelState();
    let t = 0;
    // Sustained frames of the same synthetic signal, well past both sustain windows.
    for (let i = 0; i < 40; i++) {
      t += 500;
      s = stepAutoLevel(s, flatPlusSignal(-90, -20), t, null, null);
    }
    expect(s.committedFloorDb).toBeCloseTo(-90 - DEFAULT_AUTO_LEVEL_OPTIONS.floorMarginDb, 0);
    expect(s.committedCeilingDb).toBeCloseTo(-20 + DEFAULT_AUTO_LEVEL_OPTIONS.ceilingHeadroomDb, 0);
    // display should have glided all the way to the committed values by now
    expect(s.displayFloorDb).toBeCloseTo(s.committedFloorDb, 0);
    expect(s.displayCeilingDb).toBeCloseTo(s.committedCeilingDb, 0);
  });

  it('bypasses percentile/hysteresis for an axis given a non-null manual target and eases toward it', () => {
    let s = stepAutoLevel(createAutoLevelState(), flatPlusSignal(-90, -20), 0, -60, -10);
    expect(s.displayFloorDb).toBe(-60);
    expect(s.displayCeilingDb).toBe(-10);
    // manual target continues to be honored (and glided toward) on later frames too
    s = stepAutoLevel(s, flatPlusSignal(-90, -20), 500, -55, -5);
    expect(s.displayFloorDb).toBeGreaterThan(-60);
    expect(s.displayFloorDb).toBeLessThan(-55);
  });

  it('keeps a render-safe minimum gap between floor and ceiling even under extreme drift', () => {
    let s = createAutoLevelState();
    // Cold-seed with a very hot, uniform "signal" so floor and ceiling start close together.
    s = stepAutoLevel(s, flatPlusSignal(-20, -20), 0, null, null);
    expect(s.committedCeilingDb - s.committedFloorDb).toBeGreaterThanOrEqual(DEFAULT_AUTO_LEVEL_OPTIONS.floorCeilingMinGapDb);
  });

  describe('ceiling decay', () => {
    function run(s: ReturnType<typeof createAutoLevelState>, frame: Float32Array, t: { ms: number }, iterations: number, stepMs = 500) {
      for (let i = 0; i < iterations; i++) {
        t.ms += stepMs;
        s = stepAutoLevel(s, frame, t.ms, null, null);
      }
      return s;
    }

    it('a sustained drop in signal levels eventually decays the ceiling, without ever moving the floor', () => {
      const t = { ms: 0 };
      let s = createAutoLevelState();
      s = run(s, flatPlusSignal(-90, -20), t, 20); // phase 1: settle normally
      const floorAfterPhase1 = s.committedFloorDb;
      const ceilingAfterPhase1 = s.committedCeilingDb;
      expect(ceilingAfterPhase1).toBeCloseTo(-20 + DEFAULT_AUTO_LEVEL_OPTIONS.ceilingHeadroomDb, 0);

      // Phase 2: noise floor unchanged, but the peak signal itself drops
      // 18dB (e.g. RX attenuation, antenna change) -- entirely independent
      // of floor, which should never move here.
      s = run(s, flatPlusSignal(-90, -38), t, 20); // 10s: lets ceilingTrendDb start converging
      expect(s.committedFloorDb).toBe(floorAfterPhase1);
      expect(s.committedCeilingDb).toBe(ceilingAfterPhase1); // not yet -- well under the 60s gate

      s = run(s, flatPlusSignal(-90, -38), t, 120); // another 60s
      expect(s.committedFloorDb).toBe(floorAfterPhase1); // still never moved
      expect(s.committedCeilingDb).toBeLessThan(ceilingAfterPhase1); // decayed
      expect(s.committedCeilingDb).toBeCloseTo(-38 + DEFAULT_AUTO_LEVEL_OPTIONS.ceilingHeadroomDb, 0);
    });

    it('a real signal reappearing partway through the wait fully resets the decay countdown', () => {
      const t = { ms: 0 };
      let s = createAutoLevelState();
      s = run(s, flatPlusSignal(-90, -20), t, 20);
      const ceilingAfterPhase1 = s.committedCeilingDb;

      s = run(s, flatPlusSignal(-90, -38), t, 100); // 50s of drop -- starts the countdown, well under 60s
      expect(s.committedCeilingDb).toBe(ceilingAfterPhase1);

      s = run(s, flatPlusSignal(-90, -20), t, 16); // ~8s: the original strong signal reappears briefly

      // Resume the drop. If the countdown had NOT reset, total elapsed
      // "quiet" time would already exceed 60s well before this loop ends --
      // asserting it's still uncommitted here is the proof the clock
      // actually restarted rather than merely pausing.
      s = run(s, flatPlusSignal(-90, -38), t, 100); // 50s more
      expect(s.committedCeilingDb).toBe(ceilingAfterPhase1);

      s = run(s, flatPlusSignal(-90, -38), t, 30); // past a fresh 60s since the reset
      expect(s.committedCeilingDb).toBeLessThan(ceilingAfterPhase1);
    });

    it('keeps the render-safe minimum gap even when decay would otherwise collapse it toward the floor', () => {
      const t = { ms: 0 };
      let s = createAutoLevelState();
      s = run(s, flatPlusSignal(-90, -20), t, 20);

      // The "signal" disappears entirely -- flat noise everywhere. Ceiling's
      // natural decay target (noise + ceilingHeadroomDb=3) would land only
      // 8dB above floor's target (noise - floorMarginDb=5), under the 10dB
      // floorCeilingMinGapDb -- the clamp must intervene.
      const flatNoise = new Float32Array(500).fill(-90);
      s = run(s, flatNoise, t, 160); // 80s, comfortably past the 60s decay gate
      expect(s.committedCeilingDb - s.committedFloorDb).toBeGreaterThanOrEqual(DEFAULT_AUTO_LEVEL_OPTIONS.floorCeilingMinGapDb);
    });
  });
});

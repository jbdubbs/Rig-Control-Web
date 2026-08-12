// Percentile-based noise-floor estimation + ratcheted, transient-rejecting
// peak-hold ceiling — the standard technique panadapter/spectrum-analyzer
// auto-level features use, since most bins in a wideband capture are noise
// even with a few strong signals present. Operates purely on real dB values
// (dBm or dBFS, whichever the caller has already decoded); knows nothing
// about the 0-255 byte encoding any particular spectrum source uses.
//
// Floor percentile choice: a single, un-averaged ("single-look") power
// spectrum estimate is exponentially distributed even when the true noise
// power is constant (2-DOF chi-squared), so a low percentile like p10 lands
// deep in that distribution's left tail — roughly 10*log10(-ln(1-p)) dB below
// the true mean. For p10 that's ~-9.8dB; for p63.2 (the percentile at which
// exp(-1) sets in — literally the distribution's own mean) it's ~0dB. Sources
// whose raw bins are single-look (e.g. a live FT4222 SPI stream with no
// built-in averaging) should use a percentile near p63 to land on the true
// mean instead of the tail; sources whose data is already averaged upstream
// (radio-side detector averaging, or a Web Audio AnalyserNode's own
// smoothingTimeConstant) can stay closer to p10 since the tail is far less
// pronounced there. This is why floorPercentile is per-source configurable
// rather than a single constant.

export interface AutoLevelOptions {
  floorPercentile: number;
  ceilingPercentile: number;
  trendTauMs: number;
  floorDeadbandDb: number;
  floorSustainMs: number;
  floorMarginDb: number;
  ceilingWindowMs: number;
  ceilingHitFraction: number;
  ceilingHeadroomDb: number;
  ceilingDecayDeadbandDb: number;
  ceilingDecaySustainMs: number;
  displayGlideTauMs: number;
  floorCeilingMinGapDb: number;
}

export const DEFAULT_AUTO_LEVEL_OPTIONS: Required<AutoLevelOptions> = {
  floorPercentile: 10, // see file header; appropriate for already-averaged sources
  // True max, not a lower percentile: a narrow single-tone signal (1-3 bins
  // out of e.g. 850) never reaches a 99th-percentile bar (needs ~1% of all
  // bins, i.e. ~9), so p99 measures the signal's skirt, not its peak.
  ceilingPercentile: 100,
  trendTauMs: 2000, // smooths frame-to-frame percentile jitter before decisions see it
  floorDeadbandDb: 6, // normal band-noise "breathing" shouldn't trigger a re-adjustment
  floorSustainMs: 3000, // the "marked/significant change" gate, distinct from trend smoothing
  floorMarginDb: 5, // noise floor renders ~5dB above the bottom edge, never clipped off-screen
  // Duty-cycle debounce (leaky-bucket): time-above-threshold accumulates
  // while the trend exceeds the implied peak and drains while it doesn't,
  // clamped to [0, ceilingWindowMs]. Committing once the accumulator reaches
  // ceilingHitFraction of the window tolerates real modulated signals (CW
  // dits, SSB syllables, fading) that are only intermittently above
  // threshold, while a genuine single-frame transient (static crash,
  // key-click) never accumulates close to the fraction before draining back
  // out on the very next frame.
  ceilingWindowMs: 1200,
  ceilingHitFraction: 0.4,
  ceilingHeadroomDb: 3, // strongest signal doesn't paint on the literal top pixel row
  // Ceiling decay: the ratchet above only ever raises the ceiling, so a
  // sustained real drop in signal levels (attenuation, antenna/environment
  // change) would otherwise leave the ceiling permanently stale, clipping
  // headroom the display no longer needs. This is a second, independent,
  // much more conservative path that can lower the ceiling — deliberately
  // asymmetric from the rise side: a false decay (re-clipping a real peak)
  // is worse than a false hold (wasted headroom a bit longer), so any sign
  // of a real signal near the old ceiling fully cancels the countdown
  // (no duty-cycle tolerance, unlike ceilingHitFraction above). 15dB is
  // comfortably past normal QSB/fading (a few dB, rarely >10-15dB); 1 minute
  // is long enough that no normal QSO pause, pileup gap, or band-scanning
  // silence should ever trigger it, short enough to recover within a
  // session after a genuine, sustained change.
  ceilingDecayDeadbandDb: 15,
  ceilingDecaySustainMs: 60000,
  displayGlideTauMs: 800, // eases the rendered value toward its target so changes never look jarring
  // Safety net: since the ceiling can only rise while the floor can rise too
  // (e.g. a sudden band-wide noise event), guarantee a render-safe gap so
  // (ceiling - floor) never collapses to zero or goes negative.
  floorCeilingMinGapDb: 10,
};

export interface AutoLevelState {
  seeded: boolean;
  floorTrendDb: number;
  ceilingTrendDb: number;
  committedFloorDb: number;
  committedCeilingDb: number;
  floorDriftSinceMs: number | null;
  ceilingAboveMs: number;
  ceilingCandidatePeakDb: number | null;
  ceilingDecaySinceMs: number | null;
  displayFloorDb: number;
  displayCeilingDb: number;
  lastSampleMs: number | null;
}

export function createAutoLevelState(): AutoLevelState {
  return {
    seeded: false,
    floorTrendDb: 0,
    ceilingTrendDb: 0,
    committedFloorDb: 0,
    committedCeilingDb: 0,
    floorDriftSinceMs: null,
    ceilingAboveMs: 0,
    ceilingCandidatePeakDb: null,
    ceilingDecaySinceMs: null,
    displayFloorDb: 0,
    displayCeilingDb: 0,
    lastSampleMs: null,
  };
}

export function percentile(values: ArrayLike<number>, p: number): number {
  const n = values.length;
  if (n === 0) return 0;
  const sorted = Array.from(values).sort((a, b) => a - b);
  if (n === 1) return sorted[0];
  const idx = (p / 100) * (n - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  const frac = idx - lo;
  return sorted[lo] + (sorted[hi] - sorted[lo]) * frac;
}

export function ewmaStep(prev: number, sample: number, dtMs: number, tauMs: number): number {
  if (dtMs <= 0) return prev;
  if (tauMs <= 0) return sample;
  const alpha = 1 - Math.exp(-dtMs / tauMs);
  return prev + (sample - prev) * alpha;
}

export function updateFloorHysteresis(
  prev: { committedFloorDb: number; floorDriftSinceMs: number | null },
  trendDb: number,
  nowMs: number,
  opts: Required<AutoLevelOptions>,
): { committedFloorDb: number; floorDriftSinceMs: number | null } {
  const impliedNoiseFloor = prev.committedFloorDb + opts.floorMarginDb;
  const delta = trendDb - impliedNoiseFloor;
  if (Math.abs(delta) < opts.floorDeadbandDb) {
    return { committedFloorDb: prev.committedFloorDb, floorDriftSinceMs: null };
  }
  const driftSince = prev.floorDriftSinceMs ?? nowMs;
  if (nowMs - driftSince >= opts.floorSustainMs) {
    return { committedFloorDb: trendDb - opts.floorMarginDb, floorDriftSinceMs: null };
  }
  return { committedFloorDb: prev.committedFloorDb, floorDriftSinceMs: driftSince };
}

export function updateCeilingRatchet(
  prev: { committedCeilingDb: number; ceilingAboveMs: number; ceilingCandidatePeakDb: number | null },
  trendDb: number,
  dtMs: number,
  opts: Required<AutoLevelOptions>,
): { committedCeilingDb: number; ceilingAboveMs: number; ceilingCandidatePeakDb: number | null } {
  const impliedPeak = prev.committedCeilingDb - opts.ceilingHeadroomDb;
  const above = trendDb > impliedPeak;

  const ceilingAboveMs = above
    ? Math.min(opts.ceilingWindowMs, prev.ceilingAboveMs + dtMs)
    : Math.max(0, prev.ceilingAboveMs - dtMs);
  const ceilingCandidatePeakDb = above
    ? Math.max(prev.ceilingCandidatePeakDb ?? trendDb, trendDb)
    : (ceilingAboveMs > 0 ? prev.ceilingCandidatePeakDb : null);

  if (ceilingCandidatePeakDb !== null && ceilingAboveMs >= opts.ceilingWindowMs * opts.ceilingHitFraction) {
    return {
      committedCeilingDb: Math.max(prev.committedCeilingDb, ceilingCandidatePeakDb + opts.ceilingHeadroomDb),
      ceilingAboveMs: 0,
      ceilingCandidatePeakDb: null,
    };
  }
  return { committedCeilingDb: prev.committedCeilingDb, ceilingAboveMs, ceilingCandidatePeakDb };
}

// The only path that can ever lower committedCeilingDb — independent of
// updateCeilingRatchet (rise) and of floor movement entirely (coupling
// ceiling to floor's movement was considered and rejected: a real scenario
// is the noise floor dropping while actual signal peaks are unaffected,
// which would incorrectly drag ceiling down too). Deliberately no
// duty-cycle tolerance like the rise side has: any excursion back within
// the deadband cancels the countdown outright, since a false decay
// (re-clipping a real peak) is worse than a false hold.
export function updateCeilingDecay(
  prev: { committedCeilingDb: number; ceilingDecaySinceMs: number | null },
  trendDb: number,
  nowMs: number,
  opts: Required<AutoLevelOptions>,
): { committedCeilingDb: number; ceilingDecaySinceMs: number | null } {
  const impliedPeak = prev.committedCeilingDb - opts.ceilingHeadroomDb;
  const gapDb = impliedPeak - trendDb;
  if (gapDb < opts.ceilingDecayDeadbandDb) {
    return { committedCeilingDb: prev.committedCeilingDb, ceilingDecaySinceMs: null };
  }
  const decaySince = prev.ceilingDecaySinceMs ?? nowMs;
  if (nowMs - decaySince >= opts.ceilingDecaySustainMs) {
    return { committedCeilingDb: trendDb + opts.ceilingHeadroomDb, ceilingDecaySinceMs: null };
  }
  return { committedCeilingDb: prev.committedCeilingDb, ceilingDecaySinceMs: decaySince };
}

// floorTarget/ceilingTarget non-null means that axis is currently in manual
// mode: its committed/trend tracking still runs every call (so it never goes
// stale — "should be measuring constantly" even while not the active display
// source), but the display value eases toward the given manual value instead
// of the tracked auto value. This is also what gives manual slider drags the
// same no-instant-jump glide treatment as auto adjustments.
export function stepAutoLevel(
  prev: AutoLevelState,
  dbValues: ArrayLike<number>,
  nowMs: number,
  floorTarget: number | null,
  ceilingTarget: number | null,
  opts: Partial<AutoLevelOptions> = {},
): AutoLevelState {
  const o: Required<AutoLevelOptions> = { ...DEFAULT_AUTO_LEVEL_OPTIONS, ...opts };

  const pFloor = percentile(dbValues, o.floorPercentile);
  const pCeiling = percentile(dbValues, o.ceilingPercentile);

  if (!prev.seeded) {
    const committedCeilingDb = pCeiling + o.ceilingHeadroomDb;
    const committedFloorDb = Math.min(pFloor - o.floorMarginDb, committedCeilingDb - o.floorCeilingMinGapDb);
    return {
      seeded: true,
      floorTrendDb: pFloor,
      ceilingTrendDb: pCeiling,
      committedFloorDb,
      committedCeilingDb,
      floorDriftSinceMs: null,
      ceilingAboveMs: 0,
      ceilingCandidatePeakDb: null,
      ceilingDecaySinceMs: null,
      displayFloorDb: floorTarget ?? committedFloorDb,
      displayCeilingDb: ceilingTarget ?? committedCeilingDb,
      lastSampleMs: nowMs,
    };
  }

  const dtMs = prev.lastSampleMs === null ? 0 : Math.max(0, nowMs - prev.lastSampleMs);

  const floorTrendDb = ewmaStep(prev.floorTrendDb, pFloor, dtMs, o.trendTauMs);
  const ceilingTrendDb = ewmaStep(prev.ceilingTrendDb, pCeiling, dtMs, o.trendTauMs);

  const floorResult = updateFloorHysteresis(
    { committedFloorDb: prev.committedFloorDb, floorDriftSinceMs: prev.floorDriftSinceMs },
    floorTrendDb,
    nowMs,
    o,
  );
  const ceilingRiseResult = updateCeilingRatchet(
    { committedCeilingDb: prev.committedCeilingDb, ceilingAboveMs: prev.ceilingAboveMs, ceilingCandidatePeakDb: prev.ceilingCandidatePeakDb },
    ceilingTrendDb,
    dtMs,
    o,
  );

  // A genuine new peak is the strongest evidence against decaying —
  // force-cancel the decay clock on a same-frame rise commit. (Belt-and-
  // suspenders on top of the structural mutual exclusivity between rise's
  // gapDb<0 and decay's gapDb>=ceilingDecayDeadbandDb gates: robust even if
  // a future override sets the deadband to 0.)
  const roseThisFrame = ceilingRiseResult.committedCeilingDb > prev.committedCeilingDb;
  const ceilingDecayResult = updateCeilingDecay(
    {
      committedCeilingDb: ceilingRiseResult.committedCeilingDb,
      ceilingDecaySinceMs: roseThisFrame ? null : prev.ceilingDecaySinceMs,
    },
    ceilingTrendDb,
    nowMs,
    o,
  );

  // Decay is the only path that can lower committedCeilingDb — clamp it
  // against *last* frame's floor (avoiding a same-frame circular dependency
  // with floor's own clamp below) so a deep decay can never collapse the
  // floor/ceiling gap and, via the floor clamp that reads this value,
  // indirectly drag floor down to chase it.
  const ceilingCommittedDb = Math.max(
    ceilingDecayResult.committedCeilingDb,
    prev.committedFloorDb + o.floorCeilingMinGapDb,
  );
  const decayCommittedThisFrame = ceilingDecayResult.committedCeilingDb < ceilingRiseResult.committedCeilingDb;

  const safeCommittedFloorDb = Math.min(floorResult.committedFloorDb, ceilingCommittedDb - o.floorCeilingMinGapDb);
  const floorGlideTarget = floorTarget ?? safeCommittedFloorDb;
  const ceilingGlideTarget = ceilingTarget ?? ceilingCommittedDb;

  return {
    seeded: true,
    floorTrendDb,
    ceilingTrendDb,
    committedFloorDb: safeCommittedFloorDb,
    committedCeilingDb: ceilingCommittedDb,
    floorDriftSinceMs: floorResult.floorDriftSinceMs,
    ceilingAboveMs: decayCommittedThisFrame ? 0 : ceilingRiseResult.ceilingAboveMs,
    ceilingCandidatePeakDb: decayCommittedThisFrame ? null : ceilingRiseResult.ceilingCandidatePeakDb,
    ceilingDecaySinceMs: ceilingDecayResult.ceilingDecaySinceMs,
    displayFloorDb: ewmaStep(prev.displayFloorDb, floorGlideTarget, dtMs, o.displayGlideTauMs),
    displayCeilingDb: ewmaStep(prev.displayCeilingDb, ceilingGlideTarget, dtMs, o.displayGlideTauMs),
    lastSampleMs: nowMs,
  };
}

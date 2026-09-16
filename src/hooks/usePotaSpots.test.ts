import { describe, expect, it } from 'vitest';
import {
  inferTuneMode,
  dedupeAndFilterSpots,
  sortSpots,
  computeMatchedSpotIds,
  pinMatchedSpots,
  potaAccessors,
  sotaAccessors,
  wwffAccessors,
  type SpotAccessors,
} from './usePotaSpots';
import type { PotaSpot, SotaSpot, WwffSpot } from '../types';

describe('inferTuneMode', () => {
  it('maps SSB to USB at/above 10 MHz, LSB below', () => {
    expect(inferTuneMode('SSB', 14.313, [])).toBe('USB');
    expect(inferTuneMode('SSB', 10, [])).toBe('USB');
    expect(inferTuneMode('SSB', 3.985, [])).toBe('LSB');
  });

  it('maps CW to CW at/above 10 MHz, CWR below', () => {
    expect(inferTuneMode('CW', 14.02, [])).toBe('CW');
    expect(inferTuneMode('CW', 10, [])).toBe('CW');
    expect(inferTuneMode('CW', 3.5, [])).toBe('CWR');
  });

  it('maps FT8/FT4 to PKTUSB when the rig supports it', () => {
    expect(inferTuneMode('FT8', 14.074, ['USB', 'LSB', 'PKTUSB'])).toBe('PKTUSB');
    expect(inferTuneMode('FT4', 7.047, ['USB', 'LSB', 'PKTUSB'])).toBe('PKTUSB');
  });

  it('falls back to USB for FT8/FT4 when the rig has no PKTUSB mode', () => {
    expect(inferTuneMode('FT8', 14.074, ['USB', 'LSB'])).toBe('USB');
    expect(inferTuneMode('FT4', 7.047, [])).toBe('USB');
  });

  it('passes through any other mode unchanged', () => {
    expect(inferTuneMode('USB', 14.313, [])).toBe('USB');
    expect(inferTuneMode('RTTY', 14.08, [])).toBe('RTTY');
  });
});

// Minimal generic spot shape for testing the shared pipeline in isolation from any real
// spot type's field names/units.
interface TestSpot {
  key: string;
  ms: number;
  id: number;
  khz: number;
  mode: string;
}
const testAccessors: SpotAccessors<TestSpot> = {
  dedupKey: (s) => s.key,
  timeMs: (s) => s.ms,
  idOf: (s) => s.id,
  freqKhz: (s) => s.khz,
  modeOf: (s) => s.mode,
};
const ALL_MODES = ['SSB', 'CW', 'FT8', 'FT4'];
const spot = (overrides: Partial<TestSpot>): TestSpot => ({
  key: 'W1AW', ms: Date.now(), id: 1, khz: 14000, mode: 'SSB', ...overrides,
});

describe('dedupeAndFilterSpots', () => {
  it('keeps only the most recent spot per dedup key', () => {
    const now = Date.now();
    const older = spot({ key: 'W1AW', id: 1, ms: now - 2000 });
    const newer = spot({ key: 'W1AW', id: 2, ms: now - 1000 });
    const result = dedupeAndFilterSpots([older, newer], testAccessors, 15, ALL_MODES, []);
    expect(result).toEqual([newer]);
  });

  it('drops spots older than maxAgeMinutes', () => {
    const now = Date.now();
    const fresh = spot({ ms: now, id: 1 });
    const stale = spot({ key: 'K1ABC', ms: now - 20 * 60 * 1000, id: 2 });
    const result = dedupeAndFilterSpots([fresh, stale], testAccessors, 15, ALL_MODES, []);
    expect(result.map(s => s.id)).toEqual([1]);
  });

  it('filters by mode when not all modes are selected', () => {
    const ssb = spot({ key: 'A', id: 1, mode: 'SSB' });
    const cw = spot({ key: 'B', id: 2, mode: 'CW' });
    const result = dedupeAndFilterSpots([ssb, cw], testAccessors, 1000, ['CW'], []);
    expect(result.map(s => s.id)).toEqual([2]);
  });

  it('filters by band', () => {
    const on20m = spot({ key: 'A', id: 1, khz: 14100 });
    const on40m = spot({ key: 'B', id: 2, khz: 7100 });
    const result = dedupeAndFilterSpots([on20m, on40m], testAccessors, 1000, ALL_MODES, ['40M']);
    expect(result.map(s => s.id)).toEqual([2]);
  });

  it('correctly ages out a WWFF spot whose spot_time is Unix epoch seconds, not ms', () => {
    // This is the exact bug class issue #89 calls out: WWFF's raw timestamp is in seconds,
    // unlike POTA/SOTA's ISO-ish strings — wwffAccessors.timeMs must convert it to ms before
    // any age comparison, or every spot looks either always-fresh or always-ancient.
    const nowSec = Math.floor(Date.now() / 1000);
    const fresh: WwffSpot = {
      id: 1, activator: 'K1ABC', frequency_khz: 14060, mode: 'CW', reference: 'KFF-0001',
      reference_name: 'Test Forest', remarks: '', spotter: 'N0CALL', latitude: 0, longitude: 0,
      spot_time: nowSec - 60, spot_time_formatted: '',
    };
    const stale: WwffSpot = { ...fresh, id: 2, activator: 'K2DEF', spot_time: nowSec - 20 * 60 };
    const result = dedupeAndFilterSpots([fresh, stale], wwffAccessors, 15, ALL_MODES, []);
    expect(result.map(s => s.id)).toEqual([1]);
  });

  // ISO-ish strings with no trailing "Z" — matches the raw shape the real APIs send,
  // which potaAccessors/sotaAccessors parse by appending "Z" before new Date(...).
  const isoNoZ = (msAgo: number) => new Date(Date.now() - msAgo).toISOString().replace('Z', '');

  it('dedupes real POTA spots by activator, keeping the most recently spotted one', () => {
    const older: PotaSpot = {
      spotId: 1, spotTime: isoNoZ(2000), activator: 'W1AW', frequency: 14060, mode: 'CW',
      reference: 'K-0001', name: 'Test Park', locationDesc: 'US-CT', spotter: 'N0CALL',
      source: 'test', comments: '',
    };
    const newer: PotaSpot = { ...older, spotId: 2, spotTime: isoNoZ(1000), comments: 'newer' };
    const result = dedupeAndFilterSpots([older, newer], potaAccessors, 15, ALL_MODES, []);
    expect(result.map(s => s.spotId)).toEqual([2]);
  });

  it('dedupes real SOTA spots by activatorCallsign using the ISO timeStamp field', () => {
    const older: SotaSpot = {
      id: 1, activatorCallsign: 'W1AW', frequency: '14.060', mode: 'CW',
      associationCode: 'W1', summitCode: 'CT-001', timeStamp: isoNoZ(2000),
    };
    const newer: SotaSpot = { ...older, id: 2, timeStamp: isoNoZ(1000) };
    const result = dedupeAndFilterSpots([older, newer], sotaAccessors, 15, ALL_MODES, []);
    expect(result.map(s => s.id)).toEqual([2]);
  });
});

describe('sortSpots', () => {
  const a = spot({ key: 'A', id: 1, khz: 7000 });
  const b = spot({ key: 'B', id: 2, khz: 14000 });

  it('sorts ascending by a numeric field', () => {
    expect(sortSpots([b, a], 'khz', 'asc').map(s => s.id)).toEqual([1, 2]);
  });

  it('sorts descending by a numeric field', () => {
    expect(sortSpots([a, b], 'khz', 'desc').map(s => s.id)).toEqual([2, 1]);
  });

  it('sorts by a string field via localeCompare', () => {
    expect(sortSpots([b, a], 'key', 'asc').map(s => s.id)).toEqual([1, 2]);
  });

  it('returns the input order unchanged when sortDir is "api" or sortCol is null', () => {
    expect(sortSpots([b, a], 'khz', 'api')).toEqual([b, a]);
    expect(sortSpots([b, a], null, 'asc')).toEqual([b, a]);
  });
});

describe('computeMatchedSpotIds', () => {
  it('matches a spot within 100Hz of the active VFO', () => {
    const s = spot({ id: 5, khz: 14074 }); // 14.074000 MHz
    const ids = computeMatchedSpotIds([s], testAccessors.freqKhz, testAccessors.idOf, '14.074000');
    expect(ids.has(5)).toBe(true);
  });

  it('does not match a spot outside the 100Hz tolerance', () => {
    const s = spot({ id: 5, khz: 14074 });
    const ids = computeMatchedSpotIds([s], testAccessors.freqKhz, testAccessors.idOf, '14.075000');
    expect(ids.has(5)).toBe(false);
  });
});

describe('pinMatchedSpots', () => {
  it('pins matched spots to the front while keeping the full list after', () => {
    const a = spot({ id: 1 });
    const b = spot({ id: 2 });
    const c = spot({ id: 3 });
    const result = pinMatchedSpots([a, b, c], new Set([2]), testAccessors.idOf);
    expect(result.map(r => [r.spot.id, r.isPinned])).toEqual([
      [2, true],
      [1, false], [2, false], [3, false],
    ]);
  });

  it('returns everything unpinned when nothing matches', () => {
    const a = spot({ id: 1 });
    const result = pinMatchedSpots([a], new Set(), testAccessors.idOf);
    expect(result).toEqual([{ spot: a, isPinned: false }]);
  });
});

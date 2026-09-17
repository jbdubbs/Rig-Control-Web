import { describe, expect, it } from 'vitest';
import { FT8_RESYNC_GAP_MS, shouldResyncSlot } from './ft8SlotSync';

describe('shouldResyncSlot', () => {
  it('does not resync on the very first chunk (no prior wall-clock time)', () => {
    expect(shouldResyncSlot(null, 1_000_000)).toBe(false);
  });

  it('does not resync for normal chunk-to-chunk jitter', () => {
    expect(shouldResyncSlot(1_000_000, 1_001_000)).toBe(false);
  });

  it('does not resync exactly at the threshold', () => {
    expect(shouldResyncSlot(1_000_000, 1_000_000 + FT8_RESYNC_GAP_MS)).toBe(false);
  });

  it('resyncs once the gap exceeds the threshold', () => {
    expect(shouldResyncSlot(1_000_000, 1_000_000 + FT8_RESYNC_GAP_MS + 1)).toBe(true);
  });

  it('resyncs after a long stall (e.g. a frozen/backgrounded tab)', () => {
    expect(shouldResyncSlot(1_000_000, 1_000_000 + 5 * 60 * 1000)).toBe(true);
  });
});

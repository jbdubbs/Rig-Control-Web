import { describe, it, expect } from 'vitest';
import {
  clampScale,
  isPhoneWidth,
  parseStoredScale,
  physicalLayoutWidth,
  stepScale,
} from './uiScale';

describe('uiScale', () => {
  it('clamps to range and snaps to the step', () => {
    expect(clampScale(0.1)).toBe(0.75);
    expect(clampScale(9)).toBe(3);
    expect(clampScale(1.1)).toBe(1);
    expect(clampScale(1.9)).toBe(2);
    expect(clampScale(NaN)).toBe(1);
  });

  it('parses stored values and tolerates junk', () => {
    expect(parseStoredScale(null)).toBe(1);
    expect(parseStoredScale('2')).toBe(2);
    expect(parseStoredScale('abc')).toBe(1);
    expect(parseStoredScale('99')).toBe(3);
  });

  it('steps within bounds', () => {
    expect(stepScale(1, 1)).toBe(1.25);
    expect(stepScale(1, -1)).toBe(0.75);
    expect(stepScale(0.75, -1)).toBe(0.75);
    expect(stepScale(3, 1)).toBe(3);
  });

  it('recovers physical width from a Chromium-zoomed innerWidth', () => {
    expect(physicalLayoutWidth(400, 2)).toBe(800);
    expect(physicalLayoutWidth(800, 1)).toBe(800);
    expect(physicalLayoutWidth(800, 0)).toBe(800);
    expect(physicalLayoutWidth(800, NaN)).toBe(800);
  });

  it('keeps Compact when zoom shrinks innerWidth but the window is wide', () => {
    expect(isPhoneWidth(400, 2)).toBe(false); // 800px window at 200% zoom
    expect(isPhoneWidth(767, 1)).toBe(true);
    expect(isPhoneWidth(768, 1)).toBe(false);
    expect(isPhoneWidth(360, 1)).toBe(true);
  });
});

import { describe, it, expect } from 'vitest';
import {
  clampScale,
  layoutWidth,
  parseStoredScale,
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

  it('divides innerWidth by the scale only on the CSS-zoom (browser) path', () => {
    expect(layoutWidth(1000, 2, true)).toBe(500);
    expect(layoutWidth(1000, 1, true)).toBe(1000);
    expect(layoutWidth(1000, 2, false)).toBe(1000); // Electron: innerWidth already shrunk
    expect(layoutWidth(1000, 0, true)).toBe(1000);
  });
});

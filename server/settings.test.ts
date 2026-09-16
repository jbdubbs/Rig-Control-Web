// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { sanitizePollRate } from './settings.ts';

describe('sanitizePollRate', () => {
  it('passes through a valid numeric value unchanged', () => {
    expect(sanitizePollRate(2000)).toBe(2000);
    expect(sanitizePollRate(250)).toBe(250);
  });

  it('passes through a valid numeric string unchanged', () => {
    expect(sanitizePollRate('1500')).toBe(1500);
  });

  it('falls back to the default for zero', () => {
    expect(sanitizePollRate(0)).toBe(2000);
  });

  it('falls back to the default for a negative number', () => {
    expect(sanitizePollRate(-500)).toBe(2000);
  });

  it('falls back to the default for NaN/non-numeric input', () => {
    expect(sanitizePollRate('abc')).toBe(2000);
    expect(sanitizePollRate(NaN)).toBe(2000);
    expect(sanitizePollRate(undefined)).toBe(2000);
    expect(sanitizePollRate(null)).toBe(2000);
  });

  it('falls back to the default for a value below the 100ms floor', () => {
    expect(sanitizePollRate(50)).toBe(2000);
    expect(sanitizePollRate(100)).toBe(100);
  });

  it('honors a custom fallback', () => {
    expect(sanitizePollRate('bad', 750)).toBe(750);
    expect(sanitizePollRate(-1, 750)).toBe(750);
  });
});

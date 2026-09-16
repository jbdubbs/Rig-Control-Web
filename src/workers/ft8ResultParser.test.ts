import { describe, expect, it } from 'vitest';
import { parseResultLine } from './ft8ResultParser';

// boundaryMs chosen so utcTime is deterministic and easy to eyeball: 2026-01-01 00:00:00 UTC
const BOUNDARY_MS = Date.UTC(2026, 0, 1, 0, 0, 0);

describe('parseResultLine', () => {
  it('parses a normal positive-SNR decode line', () => {
    expect(parseResultLine('3.2,1.36,1500,CQ TEST AB1CD FN42', BOUNDARY_MS)).toEqual({
      utcTime: '00:00:00',
      snr: 3.2,
      dt: 1.36,
      freqHz: 1500,
      message: 'CQ TEST AB1CD FN42',
    });
  });

  it('parses a negative SNR', () => {
    const result = parseResultLine('-16.0,1.36,1500,CQ TEST AB1CD FN42', BOUNDARY_MS);
    expect(result?.snr).toBe(-16.0);
  });

  it('parses a zero SNR', () => {
    const result = parseResultLine('0.0,1.36,1500,CQ TEST AB1CD FN42', BOUNDARY_MS);
    expect(result?.snr).toBe(0);
  });

  it('parses a negative DT (early timing offset)', () => {
    const result = parseResultLine('5.0,-0.42,1500,CQ TEST AB1CD FN42', BOUNDARY_MS);
    expect(result?.dt).toBe(-0.42);
  });

  it('derives utcTime from boundaryMs, not from the line contents', () => {
    const boundary = Date.UTC(2026, 5, 15, 20, 29, 15);
    const result = parseResultLine('5.0,1.0,1500,MSG', boundary);
    expect(result?.utcTime).toBe('20:29:15');
  });

  it('keeps internal spaces in the message (callsigns/grids are space-separated)', () => {
    const result = parseResultLine('5.0,1.0,1500,K1ABC W9XYZ EN37', BOUNDARY_MS);
    expect(result?.message).toBe('K1ABC W9XYZ EN37');
  });

  it('rejects a line missing fields', () => {
    expect(parseResultLine('3.2,1.36,1500', BOUNDARY_MS)).toBeNull();
  });

  it('rejects a line with an empty message', () => {
    expect(parseResultLine('3.2,1.36,1500,', BOUNDARY_MS)).toBeNull();
  });

  it('rejects non-numeric snr/dt/freq fields', () => {
    expect(parseResultLine('abc,1.36,1500,MSG', BOUNDARY_MS)).toBeNull();
    expect(parseResultLine('3.2,abc,1500,MSG', BOUNDARY_MS)).toBeNull();
    expect(parseResultLine('3.2,1.36,abc,MSG', BOUNDARY_MS)).toBeNull();
  });

  it('rejects an empty line', () => {
    expect(parseResultLine('', BOUNDARY_MS)).toBeNull();
  });
});

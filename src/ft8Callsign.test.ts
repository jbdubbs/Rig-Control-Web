import { describe, expect, it } from 'vitest';
import {
  extractTransmittingToken,
  normalizeCallsign,
  lookupCountry,
  getCallingStationCountry,
} from './ft8Callsign';

describe('extractTransmittingToken', () => {
  it('extracts call_de from a directed message with a signal report', () => {
    expect(extractTransmittingToken('K5MGY PF7DKW -15')).toBe('PF7DKW');
  });

  it('extracts call_de from a directed message with RR73', () => {
    expect(extractTransmittingToken('WB5AEE N4WYH RR73')).toBe('N4WYH');
  });

  it("extracts call_de from message.h's own documented /R example", () => {
    expect(extractTransmittingToken('WA9XYZ/R KA1ABC/R R FN42')).toBe('KA1ABC/R');
  });

  it('extracts call_de unaffected by a bracketed/hashed call_to', () => {
    expect(extractTransmittingToken('<OZ1PGB> KE2FMA/4')).toBe('KE2FMA/4');
  });

  it('extracts the caller from a plain CQ + grid message', () => {
    expect(extractTransmittingToken('CQ AB1CD FN42')).toBe('AB1CD');
  });

  it('extracts the caller from a CQ + qualifier + grid message (real captured POTA example)', () => {
    expect(extractTransmittingToken('CQ POTA VE9PHX FN76')).toBe('VE9PHX');
  });

  it('extracts the caller from a CQ message with no grid', () => {
    expect(extractTransmittingToken('CQ AB1CD')).toBe('AB1CD');
  });

  it('returns null for a CQ exchange it cannot confidently parse', () => {
    expect(extractTransmittingToken('CQ FD AB1CD 1A NNJ')).toBeNull();
  });

  it('returns null for an empty message', () => {
    expect(extractTransmittingToken('')).toBeNull();
    expect(extractTransmittingToken('   ')).toBeNull();
  });
});

describe('normalizeCallsign', () => {
  it('strips angle brackets from a hashed call_to', () => {
    expect(normalizeCallsign('<OZ1PGB>')).toBe('OZ1PGB');
  });

  it.each(['/P', '/M', '/MM', '/QRP', '/A', '/R'])('strips the %s portable suffix', (suffix) => {
    expect(normalizeCallsign(`G4ABC${suffix}`)).toBe('G4ABC');
  });

  it('strips a numeric area suffix', () => {
    expect(normalizeCallsign('KE2FMA/4')).toBe('KE2FMA');
  });

  it('keeps the shorter (location-prefix) side for a prefix-override call, either order', () => {
    expect(normalizeCallsign('PJ4/KA1ABC')).toBe('PJ4');
    expect(normalizeCallsign('KA1ABC/PJ4')).toBe('PJ4');
  });

  it('returns null for a malformed multi-slash callsign', () => {
    expect(normalizeCallsign('A/B/C')).toBeNull();
  });

  it('uppercases lowercase input', () => {
    expect(normalizeCallsign('ke2fma')).toBe('KE2FMA');
  });
});

describe('lookupCountry / getCallingStationCountry', () => {
  it('resolves the real captured POTA example to Canada', () => {
    expect(getCallingStationCountry('CQ POTA VE9PHX FN76')).toMatchObject({ country: 'Canada' });
  });

  it('resolves a real captured directed message to the Netherlands', () => {
    expect(getCallingStationCountry('K5MGY PF7DKW -15')).toMatchObject({ country: 'Netherlands' });
  });

  it('resolves a real captured RR73 message to the United States', () => {
    expect(getCallingStationCountry('WB5AEE N4WYH RR73')).toMatchObject({ country: 'United States' });
  });

  it('resolves a bracketed call_to + portable-suffix call_de to the United States', () => {
    expect(getCallingStationCountry('<OZ1PGB> KE2FMA/4')).toMatchObject({ country: 'United States' });
  });

  it('prefers the longer, more specific prefix match over a shorter one that also matches', () => {
    // "KH6ABC" matches both "K" (United States) and "KH6" (Hawaii) -- the
    // longer/more specific entry must win regardless of table order.
    expect(lookupCountry('KH6ABC')).toMatchObject({ country: 'Hawaii' });
  });

  it('never resolves free text to a country, even when a word happens to start with a real prefix', () => {
    // "NEW" starts with "N" (United States) -- looksLikeCallsign must reject
    // it (no digit) before it ever reaches the prefix table.
    expect(getCallingStationCountry('HAPPY NEW YEAR ALL')).toBeNull();
  });

  it('returns null for a callsign prefix not covered by the table', () => {
    expect(lookupCountry('XY1ABC')).toBeNull();
  });

  it('returns null end-to-end for an unparseable message', () => {
    expect(getCallingStationCountry('CQ FD AB1CD 1A NNJ')).toBeNull();
  });
});

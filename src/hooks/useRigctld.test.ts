import { describe, expect, it } from 'vitest';
import { dedupeRadiosById, isRigctldSettingsValid } from './useRigctld';
import type { RigctldSettings } from '../types';

function validSettings(overrides: Partial<RigctldSettings> = {}): RigctldSettings {
  return {
    rigNumber: '1035',
    serialPort: '/dev/ttyUSB0',
    portNumber: '4532',
    ipAddress: '127.0.0.1',
    serialPortSpeed: '38400',
    preampCapabilities: [],
    attenuatorCapabilities: [],
    agcCapabilities: [],
    nbSupported: false,
    nbLevelSupported: false,
    nbLevelRange: { min: 0, max: 1, step: 0.1 },
    nrSupported: false,
    nrLevelSupported: false,
    nrLevelRange: { min: 0, max: 1, step: 0.1 },
    rfLevelSupported: false,
    rfLevelRange: { min: 0, max: 1, step: 0.1 },
    rfPowerRange: { min: 0, max: 1, step: 0.01 },
    anfSupported: false,
    pttType: 'rig',
    pttFile: 'auto',
    pttGpio: 3,
    pttKey: 'AltLeft',
    ...overrides,
  };
}

describe('isRigctldSettingsValid', () => {
  it('is true when every required field is present', () => {
    expect(isRigctldSettingsValid(validSettings())).toBe(true);
  });

  it.each(['rigNumber', 'serialPort', 'portNumber', 'ipAddress', 'serialPortSpeed'] as const)(
    'is false when %s is empty',
    (field) => {
      expect(isRigctldSettingsValid(validSettings({ [field]: '' }))).toBe(false);
    },
  );

  it.each(['1', '6'])('does not require a serial port for Hamlib Dummy rig %s', (rigNumber) => {
    expect(isRigctldSettingsValid(validSettings({ rigNumber, serialPort: '' }))).toBe(true);
  });
});

describe('dedupeRadiosById', () => {
  it('collapses duplicate ids, keeping the last occurrence', () => {
    const list = [
      { id: '1', mfg: 'Icom', model: 'IC-7300' },
      { id: '2', mfg: 'Yaesu', model: 'FT-710' },
      { id: '1', mfg: 'Icom', model: 'IC-7300 (updated)' },
    ];

    expect(dedupeRadiosById(list)).toEqual([
      { id: '1', mfg: 'Icom', model: 'IC-7300 (updated)' },
      { id: '2', mfg: 'Yaesu', model: 'FT-710' },
    ]);
  });

  it('returns an empty array for an empty list', () => {
    expect(dedupeRadiosById([])).toEqual([]);
  });

  it('preserves order of first-seen unique ids', () => {
    const list = [{ id: 'b' }, { id: 'a' }, { id: 'b' }];
    expect(dedupeRadiosById(list).map((r) => r.id)).toEqual(['b', 'a']);
  });
});

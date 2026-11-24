// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  isValidCm108Path,
  sanitizeCm108Gpio,
  sanitizeCm108Path,
  sanitizePttSettings,
  sanitizePttType,
} from './ptt.ts';

const current = { pttType: 'rig' as const, pttFile: 'auto', pttGpio: 3 };

describe('sanitizePttType', () => {
  it('accepts the known types and rejects anything else', () => {
    for (const t of ['rig', 'dtr', 'rts', 'none', 'cm108']) expect(sanitizePttType(t)).toBe(t);
    expect(sanitizePttType('CM108')).toBe('rig');
    expect(sanitizePttType('--bogus')).toBe('rig');
    expect(sanitizePttType(undefined, 'dtr')).toBe('dtr');
  });
});

describe('sanitizeCm108Gpio', () => {
  it('accepts GPIO2-4 only (Hamlib treats bit 0 as unset and would key GPIO3)', () => {
    expect(sanitizeCm108Gpio(2)).toBe(2);
    expect(sanitizeCm108Gpio('4')).toBe(4);
    expect(sanitizeCm108Gpio(1)).toBe(3);
    expect(sanitizeCm108Gpio(0)).toBe(3);
    expect(sanitizeCm108Gpio(5)).toBe(3);
    expect(sanitizeCm108Gpio(2.5)).toBe(3);
    expect(sanitizeCm108Gpio('abc', 2)).toBe(2);
  });
});

describe('isValidCm108Path', () => {
  it('accepts auto and the three platform path forms', () => {
    expect(isValidCm108Path('auto')).toBe(true);
    expect(isValidCm108Path('/dev/hidraw0')).toBe(true);
    expect(isValidCm108Path('/dev/hidraw12')).toBe(true);
    expect(isValidCm108Path('\\\\?\\hid#vid_0d8c&pid_000c&mi_03#7&1b2c3d4e&0&0000#{4d1e55b2-f16f-11cf-88cb-001111000030}')).toBe(true);
    expect(isValidCm108Path('DevSrvsID:4294970000')).toBe(true);
  });

  it('rejects anything that could be mistaken for an option or another device', () => {
    for (const bad of ['', '-P', '--set-conf=x', '/dev/ttyUSB0', '/dev/hidraw0 -x', '/dev/../etc/passwd', 'DevSrvsID:abc', 'COM3', 42, null, undefined]) {
      expect(isValidCm108Path(bad)).toBe(false);
    }
  });

  it('falls back when invalid', () => {
    expect(sanitizeCm108Path('/dev/sda', '/dev/hidraw1')).toBe('/dev/hidraw1');
  });
});

describe('sanitizePttSettings', () => {
  it('only touches the PTT keys that are present and leaves the rest alone', () => {
    const out = sanitizePttSettings({ rigNumber: '1', pttType: 'cm108', pttFile: '/dev/hidraw2', pttGpio: 4 }, current);
    expect(out).toEqual({ rigNumber: '1', pttType: 'cm108', pttFile: '/dev/hidraw2', pttGpio: 4 });
    expect(sanitizePttSettings({ rigNumber: '1' }, current)).toEqual({ rigNumber: '1' });
  });

  it('replaces invalid values with the current ones', () => {
    const out = sanitizePttSettings({ pttType: 'x', pttFile: '/etc/passwd', pttGpio: 99 }, { pttType: 'dtr', pttFile: '/dev/hidraw1', pttGpio: 2 });
    expect(out).toEqual({ pttType: 'dtr', pttFile: '/dev/hidraw1', pttGpio: 2 });
  });
});

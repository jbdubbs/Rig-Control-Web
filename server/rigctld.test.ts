// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { checkVersionSupported, buildRigctldArgs, isDummyRig } from './rigctld.ts';

describe('checkVersionSupported', () => {
  it('treats an unknown (null) version as supported', () => {
    expect(checkVersionSupported(null)).toBe(true);
  });

  it('supports the exact minimum version', () => {
    expect(checkVersionSupported('4.7.0')).toBe(true);
  });

  it('supports versions above the minimum', () => {
    expect(checkVersionSupported('5.0.0')).toBe(true);
    expect(checkVersionSupported('4.8.0')).toBe(true);
    expect(checkVersionSupported('4.7.1')).toBe(true);
  });

  it('rejects versions below the minimum', () => {
    expect(checkVersionSupported('4.6.9')).toBe(false);
    expect(checkVersionSupported('4.6.99')).toBe(false);
    expect(checkVersionSupported('3.9.9')).toBe(false);
  });

  it('handles a one-part version string without throwing', () => {
    expect(checkVersionSupported('5')).toBe(true);
    expect(checkVersionSupported('4')).toBe(false);
  });

  it('handles a two-part version string without throwing', () => {
    expect(checkVersionSupported('4.7')).toBe(true);
    expect(checkVersionSupported('4.6')).toBe(false);
  });
});

describe('buildRigctldArgs', () => {
  const base = {
    rigNumber: '3073',
    serialPort: '/dev/ttyUSB0',
    portNumber: '4532',
    ipAddress: '127.0.0.1',
    serialPortSpeed: '19200',
  };
  const baseArgs = ['-m', '3073', '-r', '/dev/ttyUSB0', '-t', '4532', '-T', '127.0.0.1', '-s', '19200'];

  it('adds no PTT flags for CI-V / CAT PTT', () => {
    expect(buildRigctldArgs(base)).toEqual(baseArgs);
    expect(buildRigctldArgs({ ...base, pttType: 'rig' })).toEqual(baseArgs);
  });

  it.each([
    ['dtr', 'DTR'],
    ['rts', 'RTS'],
  ] as const)('passes %s as the PTT type (-P), not as the PTT device (-p)', (pttType, flag) => {
    const args = buildRigctldArgs({ ...base, pttType });
    expect(args).toEqual([...baseArgs, '-P', flag]);
    expect(args).not.toContain('-p');
  });

  it('keeps the historical "none" arguments unchanged', () => {
    expect(buildRigctldArgs({ ...base, pttType: 'none' })).toEqual([...baseArgs, '-p', 'NONE']);
  });

  it('builds CM108 args with a 0-based GPIO bit number', () => {
    const args = buildRigctldArgs({ ...base, pttType: 'cm108', pttFile: '/dev/hidraw3', pttGpio: 3 });
    expect(args).toEqual([...baseArgs, '-P', 'CM108', '-p', '/dev/hidraw3', '--set-conf=ptt_bitnum=2']);
    expect(buildRigctldArgs({ ...base, pttType: 'cm108', pttFile: 'auto', pttGpio: 4 })).toContain('--set-conf=ptt_bitnum=3');
  });

  it('defaults CM108 to auto device and GPIO3', () => {
    const args = buildRigctldArgs({ ...base, pttType: 'cm108' });
    expect(args).toContain('auto');
    expect(args).toContain('--set-conf=ptt_bitnum=2');
  });

  it('omits -r when there is no serial port (Dummy rig)', () => {
    expect(buildRigctldArgs({ ...base, rigNumber: '1', serialPort: '' }))
      .toEqual(['-m', '1', '-t', '4532', '-T', '127.0.0.1', '-s', '19200']);
  });

  it('appends spectrum multicast flags only when enabled', () => {
    const spectrum = { enabled: true, multicastAddr: '224.0.0.1', multicastPort: 4531 };
    expect(buildRigctldArgs(base, spectrum)).toEqual([
      ...baseArgs,
      '--set-conf=multicast_data_addr=224.0.0.1',
      '--set-conf=multicast_data_port=4531',
      '--set-conf=async=1',
    ]);
    expect(buildRigctldArgs(base, { ...spectrum, enabled: false })).toEqual(baseArgs);
  });
});

describe('isDummyRig', () => {
  it('recognises the Hamlib Dummy rigs only', () => {
    expect(isDummyRig('1')).toBe(true);
    expect(isDummyRig('6')).toBe(true);
    expect(isDummyRig('3073')).toBe(false);
    expect(isDummyRig('')).toBe(false);
  });
});

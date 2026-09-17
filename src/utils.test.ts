import { describe, expect, it } from 'vitest';
import { formatAudioDeviceOption, formatStep, shouldAttemptAutoJoin, shouldReacquireWakeLock, splitLocalAudioDevices } from './utils';

describe('formatStep', () => {
  it('formats values >= 1 as MHz', () => {
    expect(formatStep(1)).toBe('1 MHz');
    expect(formatStep(5)).toBe('5 MHz');
  });

  it('formats values >= 0.001 and < 1 as kHz', () => {
    expect(formatStep(0.1)).toBe('100 kHz');
    expect(formatStep(0.01)).toBe('10 kHz');
    expect(formatStep(0.003)).toBe('3 kHz');
    expect(formatStep(0.001)).toBe('1 kHz');
  });

  it('formats values below 0.001 as Hz', () => {
    expect(formatStep(0.0001)).toBe('100 Hz');
    expect(formatStep(0.00001)).toBe('10 Hz');
  });
});

describe('splitLocalAudioDevices', () => {
  function device(overrides: Partial<MediaDeviceInfo>): MediaDeviceInfo {
    return {
      deviceId: 'id',
      groupId: 'group',
      kind: 'audioinput',
      label: 'label',
      toJSON: () => ({}),
      ...overrides,
    } as MediaDeviceInfo;
  }

  it('drops the synthetic "default" entry', () => {
    const devices = [
      device({ deviceId: 'default', kind: 'audioinput' }),
      device({ deviceId: 'mic-1', kind: 'audioinput' }),
    ];

    const { inputs } = splitLocalAudioDevices(devices);

    expect(inputs).toHaveLength(1);
    expect(inputs[0].deviceId).toBe('mic-1');
  });

  it('splits real devices into inputs and outputs by kind', () => {
    const devices = [
      device({ deviceId: 'mic-1', kind: 'audioinput' }),
      device({ deviceId: 'speaker-1', kind: 'audiooutput' }),
      device({ deviceId: 'cam-1', kind: 'videoinput' }),
    ];

    const { inputs, outputs } = splitLocalAudioDevices(devices);

    expect(inputs.map(d => d.deviceId)).toEqual(['mic-1']);
    expect(outputs.map(d => d.deviceId)).toEqual(['speaker-1']);
  });

  it('returns empty arrays for an empty device list', () => {
    expect(splitLocalAudioDevices([])).toEqual({ inputs: [], outputs: [] });
  });
});

describe('formatAudioDeviceOption', () => {
  it('labels a non-WASAPI device with its API and sample rate', () => {
    const { label, disabled } = formatAudioDeviceOption({
      name: 'USB Audio CODEC',
      hostAPIName: 'ALSA',
      defaultSampleRate: 48000,
    });

    expect(label).toBe('USB Audio CODEC [ALSA, 48k]');
    expect(disabled).toBe(false);
  });

  it('enables a WASAPI device already at 48kHz with a plain WASAPI label', () => {
    const { label, disabled } = formatAudioDeviceOption({
      name: 'Speakers',
      hostAPIName: 'Windows WASAPI',
      defaultSampleRate: 48000,
    });

    expect(label).toBe('Speakers [WASAPI]');
    expect(disabled).toBe(false);
  });

  it('disables a WASAPI device at a mismatched sample rate with a hint', () => {
    const { label, disabled } = formatAudioDeviceOption({
      name: 'Speakers',
      hostAPIName: 'Windows WASAPI',
      defaultSampleRate: 44100,
    });

    expect(label).toBe('Speakers [WASAPI – set device to 48k in Windows]');
    expect(disabled).toBe(true);
  });

  it('falls back to a bare name when API and sample rate are both empty', () => {
    const { label, disabled } = formatAudioDeviceOption({
      name: 'Unknown Device',
      hostAPIName: '',
      defaultSampleRate: 0,
    });

    expect(label).toBe('Unknown Device');
    expect(disabled).toBe(false);
  });
});

describe('shouldAttemptAutoJoin', () => {
  it('fires when gestured, playing, and not yet ready', () => {
    expect(shouldAttemptAutoJoin('playing', false, true)).toBe(true);
  });

  it('does not fire before the page has seen a gesture', () => {
    expect(shouldAttemptAutoJoin('playing', false, false)).toBe(false);
  });

  it('does not fire once already ready', () => {
    expect(shouldAttemptAutoJoin('playing', true, true)).toBe(false);
  });

  it('does not fire while stopped or in cooldown', () => {
    expect(shouldAttemptAutoJoin('stopped', false, true)).toBe(false);
    expect(shouldAttemptAutoJoin('cooldown', false, true)).toBe(false);
  });
});

describe('shouldReacquireWakeLock', () => {
  it('reacquires when visible, active, and no sentinel held', () => {
    expect(shouldReacquireWakeLock({ documentVisible: true, isActive: true, hasSentinel: false })).toBe(true);
  });

  it('does not reacquire while hidden', () => {
    expect(shouldReacquireWakeLock({ documentVisible: false, isActive: true, hasSentinel: false })).toBe(false);
  });

  it('does not reacquire when the feature is off', () => {
    expect(shouldReacquireWakeLock({ documentVisible: true, isActive: false, hasSentinel: false })).toBe(false);
  });

  it('does not reacquire when a sentinel is already held', () => {
    expect(shouldReacquireWakeLock({ documentVisible: true, isActive: true, hasSentinel: true })).toBe(false);
  });
});

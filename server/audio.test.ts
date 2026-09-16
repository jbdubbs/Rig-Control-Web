// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { isAudioSettingsChangeAllowed, isControlAudioActionAllowed, sanitizeAudioSettingsUpdate, PcmFrameAccumulator } from './audio.ts';

describe('isAudioSettingsChangeAllowed', () => {
  it('allows an admin to change backend keys while locked', () => {
    expect(isAudioSettingsChangeAllowed(true, 'admin', ['inputDevice'])).toBe(true);
  });

  it('allows an admin to flip the lock flag itself', () => {
    expect(isAudioSettingsChangeAllowed(false, 'admin', ['backendLockedToAdmin'])).toBe(true);
    expect(isAudioSettingsChangeAllowed(true, 'admin', ['backendLockedToAdmin'])).toBe(true);
  });

  it('allows a regular user to change unrelated keys regardless of lock state', () => {
    expect(isAudioSettingsChangeAllowed(true, 'regular', ['someOtherField'])).toBe(true);
    expect(isAudioSettingsChangeAllowed(false, 'regular', ['someOtherField'])).toBe(true);
  });

  it('allows a regular user to change backend keys when not locked', () => {
    expect(isAudioSettingsChangeAllowed(false, 'regular', ['inputDevice', 'inboundEnabled'])).toBe(true);
  });

  it('rejects a regular user changing backend keys while locked', () => {
    expect(isAudioSettingsChangeAllowed(true, 'regular', ['inputDevice'])).toBe(false);
    expect(isAudioSettingsChangeAllowed(true, 'regular', ['outputDevice'])).toBe(false);
    expect(isAudioSettingsChangeAllowed(true, 'regular', ['inboundEnabled'])).toBe(false);
    expect(isAudioSettingsChangeAllowed(true, 'regular', ['outboundEnabled'])).toBe(false);
  });

  it('rejects a regular user setting the lock flag, locked or not', () => {
    expect(isAudioSettingsChangeAllowed(false, 'regular', ['backendLockedToAdmin'])).toBe(false);
    expect(isAudioSettingsChangeAllowed(true, 'regular', ['backendLockedToAdmin'])).toBe(false);
  });

  it('rejects the whole payload when a locked key is mixed with an unrelated one', () => {
    expect(isAudioSettingsChangeAllowed(true, 'regular', ['inputDevice', 'someOtherField'])).toBe(false);
  });

  it('rejects when role is unauthenticated/undefined and locked', () => {
    expect(isAudioSettingsChangeAllowed(true, undefined, ['inputDevice'])).toBe(false);
  });
});

describe('isControlAudioActionAllowed', () => {
  it('allows an admin regardless of lock state', () => {
    expect(isControlAudioActionAllowed(true, 'admin')).toBe(true);
    expect(isControlAudioActionAllowed(false, 'admin')).toBe(true);
  });

  it('allows a regular user when unlocked', () => {
    expect(isControlAudioActionAllowed(false, 'regular')).toBe(true);
  });

  it('rejects a regular user when locked', () => {
    expect(isControlAudioActionAllowed(true, 'regular')).toBe(false);
  });

  it('rejects an unauthenticated caller when locked', () => {
    expect(isControlAudioActionAllowed(true, undefined)).toBe(false);
  });
});

describe('sanitizeAudioSettingsUpdate', () => {
  it('passes through valid keys with correct types unchanged', () => {
    expect(sanitizeAudioSettingsUpdate({
      inputDevice: 'hw:1,0',
      outputDevice: 'hw:2,0',
      inboundEnabled: true,
      outboundEnabled: false,
      backendLockedToAdmin: true,
    })).toEqual({
      inputDevice: 'hw:1,0',
      outputDevice: 'hw:2,0',
      inboundEnabled: true,
      outboundEnabled: false,
      backendLockedToAdmin: true,
    });
  });

  it('drops unknown extra keys', () => {
    expect(sanitizeAudioSettingsUpdate({
      inputDevice: 'hw:1,0',
      evil: { nested: true },
    } as any)).toEqual({ inputDevice: 'hw:1,0' });
  });

  it('drops known keys with the wrong type instead of coercing them', () => {
    expect(sanitizeAudioSettingsUpdate({
      outboundEnabled: 'yes',
      inputDevice: 123,
    } as any)).toEqual({});
  });

  it('returns an empty object for an empty or garbage payload', () => {
    expect(sanitizeAudioSettingsUpdate({})).toEqual({});
    expect(sanitizeAudioSettingsUpdate(null as any)).toEqual({});
  });
});

describe('PcmFrameAccumulator', () => {
  it('does not emit a frame until enough bytes have accumulated', () => {
    const acc = new PcmFrameAccumulator(4);
    const frames: Buffer[] = [];
    acc.push(Buffer.from([1, 2]), (f) => frames.push(Buffer.from(f)));
    expect(frames).toEqual([]);
  });

  it('emits a frame once enough bytes accumulate across multiple pushes, preserving order', () => {
    const acc = new PcmFrameAccumulator(4);
    const frames: Buffer[] = [];
    acc.push(Buffer.from([1, 2]), (f) => frames.push(Buffer.from(f)));
    acc.push(Buffer.from([3, 4, 5]), (f) => frames.push(Buffer.from(f)));
    expect(frames).toEqual([Buffer.from([1, 2, 3, 4])]);
  });

  it('emits multiple frames from a single push and retains the leftover for the next push', () => {
    const acc = new PcmFrameAccumulator(2);
    const frames: Buffer[] = [];
    acc.push(Buffer.from([1, 2, 3, 4, 5]), (f) => frames.push(Buffer.from(f)));
    expect(frames).toEqual([Buffer.from([1, 2]), Buffer.from([3, 4])]);

    acc.push(Buffer.from([6]), (f) => frames.push(Buffer.from(f)));
    expect(frames).toEqual([Buffer.from([1, 2]), Buffer.from([3, 4]), Buffer.from([5, 6])]);
  });

  it('grows its internal buffer to accept a chunk larger than the initial capacity, with no data loss', () => {
    const acc = new PcmFrameAccumulator(4, 4); // tiny initial capacity forces growth
    const big = Buffer.from(Array.from({ length: 100 }, (_, i) => i));
    const frames: Buffer[] = [];
    acc.push(big, (f) => frames.push(Buffer.from(f)));
    expect(frames.length).toBe(25);
    expect(Buffer.concat(frames)).toEqual(big);
  });
});

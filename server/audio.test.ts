// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { isAudioSettingsChangeAllowed, isControlAudioActionAllowed } from './audio.ts';

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

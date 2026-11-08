// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isAudioSettingsChangeAllowed, isControlAudioActionAllowed, sanitizeAudioSettingsUpdate, PcmFrameAccumulator, buildCaptureOptions, buildPlaybackOptions, handleCaptureClosed, resetCaptureRestartBudget, StatusFlagMonitor } from './audio.ts';
import { vi } from 'vitest';

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

describe('capture stream resilience (#119)', () => {
  it('does not close the capture stream on a transient portAudio error', () => {
    const opts = buildCaptureOptions({ SampleFormat16Bit: 8 }, 5);
    expect(opts.closeOnError).toBe(false);
    expect(opts.deviceId).toBe(5);
  });

  it('restarts audio when the active capture stream closes unexpectedly', () => {
    const stream = {};
    const ctx: any = { audioInputProcess: stream, audioStatus: 'playing' };
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(handleCaptureClosed(ctx, stream)).toBe(true);
  });

  it('ignores the close of a stream that was deliberately torn down or replaced', () => {
    const stream = {};
    expect(handleCaptureClosed({ audioInputProcess: null, audioStatus: 'playing' } as any, stream)).toBe(false);
    expect(handleCaptureClosed({ audioInputProcess: {}, audioStatus: 'playing' } as any, stream)).toBe(false);
    expect(handleCaptureClosed({ audioInputProcess: stream, audioStatus: 'stopped' } as any, stream)).toBe(false);
  });
});

describe('stream option builders (#126)', () => {
  it('builds capture and playback options that never close the stream on a status flag', () => {
    const pa = { SampleFormat16Bit: 16 };
    const inOpts = buildCaptureOptions(pa, 3);
    expect(inOpts.deviceId).toBe(3);
    expect(inOpts.closeOnError).toBe(false);
    expect(inOpts.framesPerBuffer).toBe(0);
    const outOpts = buildPlaybackOptions(pa, 4);
    expect(outOpts.deviceId).toBe(4);
    expect(outOpts.closeOnError).toBe(false);
    expect(outOpts.framesPerBuffer).toBe(0);
  });

  it('does not accept a buffer-size key in audio settings updates', () => {
    expect(sanitizeAudioSettingsUpdate({ bufferFrames: 960 } as any)).toEqual({});
  });
});

describe('capture restart cap (#126)', () => {
  beforeEach(() => {
    resetCaptureRestartBudget();
    // Only Date is faked: the async restart/stop work behind handleCaptureClosed
    // still needs real promise/timer scheduling to fail fast on the bare ctx.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-08T12:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function closeOnce(errors: ReturnType<typeof vi.spyOn>) {
    const stream = {};
    errors.mockClear();
    expect(handleCaptureClosed({ audioInputProcess: stream, audioStatus: 'playing' } as any, stream)).toBe(true);
    return String(errors.mock.calls[0]?.[0] ?? '');
  }

  it('restarts the first three unexpected closes within the window, then stops instead of restarting', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    for (let i = 0; i < 3; i++) {
      expect(closeOnce(errors)).toContain('restarting backend audio');
      vi.setSystemTime(Date.now() + 1500); // ~the real loop period
    }
    const fourth = closeOnce(errors);
    expect(fourth).toContain('failed 3 times');
    expect(fourth).not.toContain('restarting backend audio');
    expect(fourth).toContain('Start Backend Audio');
  });

  it('keeps refusing to restart while the window still holds three attempts, even for later closes', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    for (let i = 0; i < 3; i++) closeOnce(errors);
    vi.setSystemTime(Date.now() + 30_000);
    expect(closeOnce(errors)).toContain('failed 3 times');
  });

  it('restarts again once the rolling window has expired', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    for (let i = 0; i < 3; i++) closeOnce(errors);
    expect(closeOnce(errors)).toContain('failed 3 times');
    vi.setSystemTime(Date.now() + 61_000);
    expect(closeOnce(errors)).toContain('restarting backend audio');
  });
});

describe('StatusFlagMonitor (#126)', () => {
  it('trips exactly once, on the flag that exceeds max within the window', () => {
    const m = new StatusFlagMonitor(3, 1000);
    expect(m.record(0)).toBe(false);
    expect(m.record(10)).toBe(false);
    expect(m.record(20)).toBe(false);
    expect(m.record(30)).toBe(true);
    expect(m.record(40)).toBe(false);
    expect(m.record(50)).toBe(false);
  });

  it('does not trip on a slow trickle of occasional overflows', () => {
    const m = new StatusFlagMonitor(3, 1000);
    for (let t = 0; t < 60_000; t += 400) expect(m.record(t)).toBe(false);
  });

  it('does not trip when a burst is spread across two windows', () => {
    const m = new StatusFlagMonitor(3, 1000);
    [0, 100, 200].forEach((t) => expect(m.record(t)).toBe(false));
    [1500, 1600, 1700].forEach((t) => expect(m.record(t)).toBe(false));
  });
});

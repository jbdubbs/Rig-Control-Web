// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRateLogger, setDebugFlag, ts, vlogAudio, vlogRig } from './vlog.ts';

afterEach(() => {
  // debugFlags is shared module-level state — reset whichever flags we
  // touched so tests don't leak into each other.
  setDebugFlag('rig', false);
  setDebugFlag('audio', false);
  vi.useRealTimers();
});

describe('ts', () => {
  it('formats a fixed time as HH:MM:SS.mmm', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 15, 9, 5, 3, 42));
    expect(ts()).toBe('09:05:03.042');
  });
});

describe('createRateLogger', () => {
  it('does not flush before the interval elapses', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const onFlush = vi.fn();
    const tick = createRateLogger<void>(1000, onFlush);

    tick();
    vi.setSystemTime(500);
    tick();

    expect(onFlush).not.toHaveBeenCalled();
  });

  it('flushes with the accumulated count, elapsed seconds, and last value once the interval elapses', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const onFlush = vi.fn();
    const tick = createRateLogger<number>(1000, onFlush);

    tick(1);
    vi.setSystemTime(400);
    tick(2);
    vi.setSystemTime(1200);
    tick(3);

    expect(onFlush).toHaveBeenCalledTimes(1);
    expect(onFlush).toHaveBeenCalledWith(3, 1.2, 3);
  });

  it('resets the count after a flush', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const onFlush = vi.fn();
    const tick = createRateLogger<void>(1000, onFlush);

    tick();
    vi.setSystemTime(1000);
    tick();
    vi.setSystemTime(2000);
    tick();

    expect(onFlush).toHaveBeenCalledTimes(2);
    expect(onFlush.mock.calls[0][0]).toBe(2);
    expect(onFlush.mock.calls[1][0]).toBe(1);
  });
});

describe('setDebugFlag', () => {
  it('gates the corresponding vlog* function on/off', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});

    vlogRig('hello');
    expect(spy).not.toHaveBeenCalled();

    setDebugFlag('rig', true);
    vlogRig('hello');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]).toContain('hello');

    setDebugFlag('rig', false);
    vlogRig('hello again');
    expect(spy).toHaveBeenCalledTimes(1);

    spy.mockRestore();
  });

  it('only affects the flag it was given, not other subsystems', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});

    setDebugFlag('rig', true);
    vlogAudio('should stay silent');
    expect(spy).not.toHaveBeenCalled();

    spy.mockRestore();
  });
});

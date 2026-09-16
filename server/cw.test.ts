// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cwTick, isValidKeyerPort } from './cw.ts';

// cwTick's iambic FSM is exercised here in "rigctld-ptt" keying mode, which
// sends real "T 1"/"T 0" commands via ctx.sendToRig instead of driving the
// cw-key-helper serial subprocess — the same path tests/e2e/cw-keyer.spec.ts
// exercises end-to-end against a real Dummy rigctld. This unit test covers
// the exhaustive timing logic (WPM math, iambic-B squeeze, the buffer-depth
// jitter delay) far more cheaply than looping real wall-clock e2e assertions.

const CLIENT_ID = 'client1';

function makeCtx(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    activeCwClientId: CLIENT_ID,
    socketConnectTimes: new Map([[CLIENT_ID, 0]]),
    cwPaddleBuffer: [] as { t: number; dit: boolean; dah: boolean; straight: boolean }[],
    cwBufferReady: false,
    cwKeyLockedOut: false,
    cwSettings: { wpm: 60, mode: 'iambic-a', keyingMethod: 'rigctld-ptt', serialKeyPolarity: 'normal' },
    cwMachine: 'IDLE',
    cwPendingElement: null,
    cwLastSentElement: null,
    cwElementEndMs: 0,
    cwKeyIsDown: false,
    cwPlayheadDit: false,
    cwPlayheadDah: false,
    cwPlayheadStraight: false,
    cwTickTimer: null,
    cwStuckKeyTimer: null,
    cwIdleTimer: null,
    cwIsKeying: false,
    cwKeyerProcess: null,
    sendToRig: vi.fn(async () => ''),
    io: { to: vi.fn(() => ({ emit: vi.fn() })), emit: vi.fn() },
    ...overrides,
  } as any;
}

// Starts the tick loop (mirrors the cw-paddle handler's initial
// setTimeout(() => cwTick(ctx), 4)) and lets it self-reschedule for totalMs.
function runTicks(ctx: any, totalMs: number) {
  cwTick(ctx);
  vi.advanceTimersByTime(totalMs);
}

// 60 WPM -> ditMs = (1.2 / 60) * 1000 = 20ms (standard PARIS timing formula).
const DIT_MS_AT_60WPM = 20;
const BUFFER_DEPTH_MS = 60;

afterEach(() => {
  vi.useRealTimers();
});

describe('cwTick', () => {
  it('keys a single dit for exactly one dit duration, after the buffer-depth delay', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const times: number[] = [];
    const ctx = makeCtx({
      cwPaddleBuffer: [
        { t: 0, dit: true, dah: false, straight: false },
        { t: 10, dit: false, dah: false, straight: false },
      ],
      sendToRig: vi.fn(async (cmd: string) => { times.push(Date.now()); return ''; }),
    });

    runTicks(ctx, 200);

    expect(ctx.sendToRig.mock.calls.map((c: any[]) => c[0])).toEqual(['T 1', 'T 0']);
    expect(times[1] - times[0]).toBe(DIT_MS_AT_60WPM);
    // Confirms the buffer-depth jitter delay: the key-down doesn't fire
    // until CW_BUFFER_DEPTH_MS after the paddle event's own timestamp.
    expect(times[0]).toBe(BUFFER_DEPTH_MS);
    expect(ctx.cwMachine).toBe('IDLE');
  });

  it('keys a single dah for approximately 3x a dit\'s duration', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const times: number[] = [];
    const ctx = makeCtx({
      cwPaddleBuffer: [
        { t: 0, dit: false, dah: true, straight: false },
        { t: 10, dit: false, dah: false, straight: false },
      ],
      sendToRig: vi.fn(async (cmd: string) => { times.push(Date.now()); return ''; }),
    });

    runTicks(ctx, 200);

    expect(ctx.sendToRig.mock.calls.map((c: any[]) => c[0])).toEqual(['T 1', 'T 0']);
    expect(times[1] - times[0]).toBe(DIT_MS_AT_60WPM * 3);
  });

  it('does not key anything before the CW_BUFFER_DEPTH_MS jitter delay elapses', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const ctx = makeCtx({
      cwPaddleBuffer: [{ t: 0, dit: true, dah: false, straight: false }],
    });

    // Advance to just under the buffer-depth threshold.
    cwTick(ctx);
    vi.advanceTimersByTime(BUFFER_DEPTH_MS - 4);

    expect(ctx.sendToRig).not.toHaveBeenCalled();
    expect(ctx.cwBufferReady).toBe(false);
  });

  it('iambic-B squeeze (both paddles held) alternates dit/dah using the memory (pending-element) behavior', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const calls: { cmd: string; t: number }[] = [];
    const ctx = makeCtx({
      cwSettings: { wpm: 60, mode: 'iambic-b', keyingMethod: 'rigctld-ptt', serialKeyPolarity: 'normal' },
      cwPaddleBuffer: [{ t: 0, dit: true, dah: true, straight: false }],
      sendToRig: vi.fn(async (cmd: string) => { calls.push({ cmd, t: Date.now() }); return ''; }),
    });

    // Run long enough to observe several elements (squeeze never returns to
    // IDLE on its own since both paddles stay held throughout).
    runTicks(ctx, BUFFER_DEPTH_MS + DIT_MS_AT_60WPM * 10);

    const keyDowns = calls.filter((c) => c.cmd === 'T 1').map((c) => c.t);
    const keyUps = calls.filter((c) => c.cmd === 'T 0').map((c) => c.t);
    expect(keyDowns.length).toBeGreaterThanOrEqual(3);
    // The squeeze never returns to IDLE on its own (both paddles stay held
    // for the whole run), so the final element may still be key-down at the
    // end of the window — only compare the fully-completed down/up pairs.
    expect(keyUps.length).toBeGreaterThanOrEqual(3);

    // First element is a dit (IDLE's playheadDit && playheadDah branch
    // starts with dit and queues dah as pending); durations should
    // alternate dit-length (20ms) and dah-length (60ms) thereafter.
    const durations = keyUps.map((up, i) => up - keyDowns[i]);
    expect(durations[0]).toBe(DIT_MS_AT_60WPM);
    expect(durations[1]).toBe(DIT_MS_AT_60WPM * 3);
    expect(durations[2]).toBe(DIT_MS_AT_60WPM);
  });

  it('does nothing when there is no active CW client', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const ctx = makeCtx({
      activeCwClientId: null,
      cwPaddleBuffer: [{ t: 0, dit: true, dah: false, straight: false }],
    });

    runTicks(ctx, 200);

    expect(ctx.sendToRig).not.toHaveBeenCalled();
    expect(ctx.cwTickTimer).toBeNull();
  });
});

const originalPlatform = process.platform;

function setPlatform(platform: NodeJS.Platform) {
  Object.defineProperty(process, 'platform', { value: platform });
}

describe('isValidKeyerPort', () => {
  afterEach(() => {
    setPlatform(originalPlatform);
  });

  it('allows an empty/unconfigured port on any platform', () => {
    setPlatform('linux');
    expect(isValidKeyerPort('')).toBe(true);
    setPlatform('win32');
    expect(isValidKeyerPort('')).toBe(true);
  });

  it('accepts real POSIX serial device paths', () => {
    setPlatform('linux');
    expect(isValidKeyerPort('/dev/ttyUSB0')).toBe(true);
    expect(isValidKeyerPort('/dev/ttyACM0')).toBe(true);
    expect(isValidKeyerPort('/dev/serial/by-id/usb-FTDI_FT232R-if00-port0')).toBe(true);
    setPlatform('darwin');
    expect(isValidKeyerPort('/dev/cu.usbserial-1420')).toBe(true);
  });

  it('rejects arbitrary host paths on POSIX', () => {
    setPlatform('linux');
    expect(isValidKeyerPort('/etc/passwd')).toBe(false);
    expect(isValidKeyerPort('../../etc/passwd')).toBe(false);
    expect(isValidKeyerPort('not-a-path')).toBe(false);
  });

  it('accepts COM ports and rejects other values on Windows', () => {
    setPlatform('win32');
    expect(isValidKeyerPort('COM4')).toBe(true);
    expect(isValidKeyerPort('com12')).toBe(true);
    expect(isValidKeyerPort('/dev/ttyUSB0')).toBe(false);
    expect(isValidKeyerPort('LPT1')).toBe(false);
  });
});

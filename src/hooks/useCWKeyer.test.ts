import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCWKeyer } from './useCWKeyer';

let envelopes: { value: number; time: number }[];

beforeEach(() => {
  vi.useFakeTimers();
  envelopes = [];
  vi.stubGlobal('AudioContext', class {
    state = 'running';
    destination = {};
    get currentTime() { return performance.now() / 1000; }
    createOscillator() { return { frequency: { value: 700 }, connect() {}, start() {} }; }
    createGain() { return { connect() {}, gain: {
      value: 0, cancelScheduledValues() {}, setValueAtTime() {},
      linearRampToValueAtTime(value: number, time: number) { envelopes.push({ value, time }); },
    } }; }
    close() { return Promise.resolve(); }
  });
});

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

function setup(mode: 'iambic-a' | 'iambic-b' | 'straight' = 'iambic-a', wpm = 60) {
  const socket = { connected: true, emit: vi.fn(), on: vi.fn(), off: vi.fn() };
  const hook = renderHook(() => useCWKeyer({ socket: socket as any, connected: true,
    localAudioOutputDevice: 'default', pttKeyRef: { current: { pttKey: 'F12' } } }));
  act(() => hook.result.current.setCwSettings(prev => ({ ...prev, enabled: true, mode, wpm })));
  return { ...hook, socket };
}

function key(type: 'keydown' | 'keyup', code: string, repeat = false) {
  act(() => { window.dispatchEvent(new KeyboardEvent(type, { code, repeat, bubbles: true, cancelable: true })); });
}

const attacks = () => envelopes.filter(e => e.value > 0).map(e => e.time);

describe('CW keyboard input and sidetone', () => {
  it.each([18, 30, 40, 60])('sends CQ in mode B at %i WPM without an extra trailing dit', wpm => {
    setup('iambic-b', wpm);
    const dit = 1200 / wpm;
    let elapsed = 0;
    const at = (time: number, type: 'keydown' | 'keyup', code: string) => {
      act(() => vi.advanceTimersByTime(time - elapsed));
      elapsed = time;
      key(type, code);
    };
    // C: -.-. Queue each opposite element during the sounding element.
    at(0, 'keydown', 'ControlRight');
    at(dit / 2, 'keyup', 'ControlRight');
    at(dit * 2, 'keydown', 'ControlLeft');
    at(dit * 2.5, 'keyup', 'ControlLeft');
    at(dit * 4.5, 'keydown', 'ControlRight');
    at(dit * 4.75, 'keyup', 'ControlRight');
    at(dit * 7, 'keydown', 'ControlLeft');
    at(dit * 7.5, 'keyup', 'ControlLeft');
    // Q: --.- Hold dah for two elements, then queue dit and final dah.
    at(dit * 14, 'keydown', 'ControlRight');
    at(dit * 19, 'keyup', 'ControlRight');
    at(dit * 20, 'keydown', 'ControlLeft');
    at(dit * 20.5, 'keyup', 'ControlLeft');
    at(dit * 22.5, 'keydown', 'ControlRight');
    at(dit * 22.75, 'keyup', 'ControlRight');
    act(() => vi.advanceTimersByTime(dit * 10));
    const tones = attacks();
    expect(tones).toHaveLength(8);
    // Tone-off ramps are the zero ramps immediately following each attack.
    const durations = envelopes.filter(e => e.value === 0).slice(0, 8)
      .map((off, i) => Math.round((off.time - tones[i] + 0.003) * 1000 / dit));
    expect(durations).toEqual([3, 1, 3, 1, 3, 3, 1, 3]);
  });

  it('starts a short tap immediately and completes exactly one dit', () => {
    const { result } = setup();
    key('keydown', 'ControlLeft');
    expect(result.current.cwKeyActive).toBe(true);
    act(() => vi.advanceTimersByTime(1));
    key('keyup', 'ControlLeft');
    act(() => vi.advanceTimersByTime(200));
    expect(attacks()).toHaveLength(1);
    expect(result.current.cwKeyActive).toBe(false);
  });

  it('releases a paddle after focus moves into a text field', () => {
    const { result, socket } = setup();
    key('keydown', 'ControlLeft');
    const input = document.createElement('input');
    document.body.append(input);
    input.focus();
    key('keyup', 'ControlLeft');
    expect(result.current.ditPressedRef.current).toBe(false);
    expect(socket.emit).toHaveBeenLastCalledWith('cw-paddle', expect.objectContaining({ dit: false, dah: false }));
    input.remove();
    act(() => vi.advanceTimersByTime(200));
    expect(attacks()).toHaveLength(1);
  });

  it('releases on blur and ignores subsequent OS auto-repeat', () => {
    const { result } = setup();
    key('keydown', 'ControlLeft');
    act(() => { window.dispatchEvent(new Event('blur')); });
    key('keydown', 'ControlLeft', true);
    act(() => vi.advanceTimersByTime(200));
    expect(result.current.ditPressedRef.current).toBe(false);
    expect(result.current.cwKeyActive).toBe(false);
    expect(attacks()).toHaveLength(1);
  });

  it('does not emit obsolete key strokes while the socket is disconnected', () => {
    const { socket } = setup();
    socket.connected = false;
    socket.emit.mockClear();
    key('keydown', 'ControlLeft');
    key('keyup', 'ControlLeft');
    expect(socket.emit).not.toHaveBeenCalled();
  });

  it.each(['iambic-a', 'iambic-b'] as const)('%s produces the expected squeeze release', mode => {
    setup(mode);
    key('keydown', 'ControlLeft');
    key('keydown', 'ControlRight');
    act(() => vi.advanceTimersByTime(10));
    key('keyup', 'ControlLeft');
    key('keyup', 'ControlRight');
    act(() => vi.advanceTimersByTime(300));
    expect(attacks()).toHaveLength(mode === 'iambic-a' ? 1 : 2);
  });

  it('preserves cadence at 18 WPM without accumulating polling delay', () => {
    setup('iambic-a', 18);
    key('keydown', 'ControlLeft');
    act(() => vi.advanceTimersByTime(1000));
    const times = attacks();
    expect(times.length).toBeGreaterThan(6);
    for (let i = 1; i < times.length; i++) {
      expect(times[i] - times[0]).toBeCloseTo(i * 2.4 / 18, 6);
    }
    key('keyup', 'ControlLeft');
  });

  it('clears the previous element and memory when changing modes', () => {
    const { result } = setup('iambic-b');
    key('keydown', 'ControlRight');
    act(() => result.current.setCwSettings(prev => ({ ...prev, mode: 'iambic-a' })));
    key('keydown', 'ControlLeft');
    key('keyup', 'ControlLeft');
    act(() => vi.advanceTimersByTime(300));
    expect(attacks()).toHaveLength(2);
    expect(result.current.cwKeyActive).toBe(false);
  });
});

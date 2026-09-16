import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { Socket } from 'socket.io-client';
import { useDiagnostics } from './useDiagnostics';

// Minimal stub matching only the on/off/emit surface useDiagnostics actually
// uses, plus an emit call log for asserting outbound emits — same pattern as
// useSpectrum.test.ts / useAuth.test.ts.
class StubSocket {
  private handlers = new Map<string, Set<(...args: any[]) => void>>();
  emitted: Array<[string, any]> = [];

  on(event: string, handler: (...args: any[]) => void) {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)!.add(handler);
    return this;
  }

  off(event: string, handler: (...args: any[]) => void) {
    this.handlers.get(event)?.delete(handler);
    return this;
  }

  emit(event: string, ...args: any[]) {
    this.emitted.push([event, args[0]]);
    this.handlers.get(event)?.forEach((h) => h(...args));
    return true;
  }
}

afterEach(() => {
  vi.useRealTimers();
});

describe('useDiagnostics', () => {
  it('starts with no logs and every debug flag false', () => {
    const socket = new StubSocket();
    const { result } = renderHook(() => useDiagnostics(socket as unknown as Socket));

    expect(result.current.logs).toEqual([]);
    expect(result.current.flags).toEqual({
      rig: false,
      audio: false,
      video: false,
      cw: false,
      infra: false,
      spectrum: false,
      spots: false,
      dxcluster: false,
      wsjtx: false,
      ft8: false,
    });
  });

  it('appends lines from diagnostics-log', () => {
    const socket = new StubSocket();
    const { result } = renderHook(() => useDiagnostics(socket as unknown as Socket));

    act(() => socket.emit('diagnostics-log', ['line one']));
    act(() => socket.emit('diagnostics-log', ['line two']));

    expect(result.current.logs).toEqual(['line one', 'line two']);
  });

  it('replaces (not appends) logs on diagnostics-log-snapshot', () => {
    const socket = new StubSocket();
    const { result } = renderHook(() => useDiagnostics(socket as unknown as Socket));

    act(() => socket.emit('diagnostics-log', ['stale line']));
    act(() => socket.emit('diagnostics-log-snapshot', ['snap one', 'snap two']));

    expect(result.current.logs).toEqual(['snap one', 'snap two']);
  });

  it('caps logs at 5000 lines, dropping the oldest', () => {
    const socket = new StubSocket();
    const { result } = renderHook(() => useDiagnostics(socket as unknown as Socket));

    const lines = Array.from({ length: 5001 }, (_, i) => `line ${i}`);
    act(() => socket.emit('diagnostics-log', lines));

    expect(result.current.logs).toHaveLength(5000);
    expect(result.current.logs[0]).toBe('line 1');
    expect(result.current.logs.at(-1)).toBe('line 5000');
  });

  it('sets flags exactly from debug-flags', () => {
    const socket = new StubSocket();
    const { result } = renderHook(() => useDiagnostics(socket as unknown as Socket));

    const flags = {
      rig: true, audio: false, video: true, cw: false,
      infra: false, spectrum: true, spots: false, wsjtx: false,
    };
    act(() => socket.emit('debug-flags', flags));

    expect(result.current.flags).toEqual(flags);
  });

  it('requestSnapshot() emits get-diagnostics-log', () => {
    const socket = new StubSocket();
    const { result } = renderHook(() => useDiagnostics(socket as unknown as Socket));

    act(() => result.current.requestSnapshot());

    expect(socket.emitted).toContainEqual(['get-diagnostics-log', undefined]);
  });

  it('toggleFlag() emits set-debug-flag with the negated current value', () => {
    const socket = new StubSocket();
    const { result } = renderHook(() => useDiagnostics(socket as unknown as Socket));

    act(() => result.current.toggleFlag('rig'));

    expect(socket.emitted).toContainEqual(['set-debug-flag', { key: 'rig', value: true }]);
  });

  it('enableAll() emits set-debug-flag(true) only for currently-false flags', () => {
    const socket = new StubSocket();
    const { result } = renderHook(() => useDiagnostics(socket as unknown as Socket));

    act(() =>
      socket.emit('debug-flags', {
        rig: true, audio: false, video: false, cw: false,
        infra: false, spectrum: false, spots: false, wsjtx: false,
      }),
    );
    // Simulating the inbound debug-flags push above also recorded it in
    // socket.emitted (StubSocket.emit is used for both directions) — reset
    // so only enableAll()'s own outbound emits are asserted on below.
    socket.emitted = [];

    act(() => result.current.enableAll());

    const setFlagCalls = socket.emitted.filter(([event]) => event === 'set-debug-flag');
    expect(setFlagCalls).toHaveLength(7); // every flag except the already-true "rig"
    expect(setFlagCalls.some(([, arg]) => arg.key === 'rig')).toBe(false);
    expect(setFlagCalls.every(([, arg]) => arg.value === true)).toBe(true);
  });

  it('clearView() resets logs to empty', () => {
    const socket = new StubSocket();
    const { result } = renderHook(() => useDiagnostics(socket as unknown as Socket));

    act(() => socket.emit('diagnostics-log', ['a line']));
    expect(result.current.logs).toEqual(['a line']);

    act(() => result.current.clearView());

    expect(result.current.logs).toEqual([]);
  });

  it('prunes log lines older than the 10-minute window via its periodic interval', () => {
    vi.useFakeTimers();
    const socket = new StubSocket();
    const { result } = renderHook(() => useDiagnostics(socket as unknown as Socket));

    act(() => socket.emit('diagnostics-log', ['old line']));
    expect(result.current.logs).toEqual(['old line']);

    act(() => {
      vi.advanceTimersByTime(11 * 60 * 1000);
    });

    expect(result.current.logs).toEqual([]);
  });
});

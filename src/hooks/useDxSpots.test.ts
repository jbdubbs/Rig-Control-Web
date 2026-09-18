import { describe, expect, it, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { Socket } from 'socket.io-client';
import { useDxSpots } from './useDxSpots';
import type { RigStatus, DxSpot } from '../types';

// Minimal stub matching only the on/off/emit surface useDxSpots actually uses,
// so tests exercise the hook's reducer/filtering logic without a real
// Socket.io connection.
class StubSocket {
  private handlers = new Map<string, Set<(...args: any[]) => void>>();

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
    this.handlers.get(event)?.forEach((h) => h(...args));
    return true;
  }
}

function makeSpot(overrides: Partial<DxSpot> = {}): DxSpot {
  return {
    id: 'W3LPL-JA1ABC-14025.0-1234',
    spotTime: Date.now(),
    spotter: 'W3LPL',
    dxCall: 'JA1ABC',
    frequency: 14025.0,
    comment: '',
    ...overrides,
  };
}

function renderDxSpots(socket: StubSocket) {
  return renderHook(() =>
    useDxSpots({
      socket: socket as unknown as Socket,
      connected: false,
      status: {} as RigStatus,
      inputVfoA: '0',
      inputVfoB: '0',
      availableModes: [],
      skipPollsCount: { current: 0 },
      setStatus: () => {},
      settingsLoaded: false,
    }),
  );
}

describe('useDxSpots', () => {
  it('ages a spot out of filteredDxSpots on its own via the periodic tick, with no new socket events', () => {
    // Regression test for issue #59: filteredDxSpots is a useMemo keyed on
    // data/settings changes — without a periodic tick forcing it to
    // recompute, a spot that should have aged out (e.g. because the telnet
    // connection dropped and no new dx-spot events are arriving) would stay
    // displayed indefinitely.
    vi.useFakeTimers();
    const socket = new StubSocket();
    const { result } = renderDxSpots(socket);

    act(() => socket.emit('dx-spot', makeSpot()));
    expect(result.current.filteredDxSpots).toHaveLength(1);

    // Default dxMaxAge is 30 minutes — advance well past it purely via the
    // timer clock (no new dx-spot event, simulating a dead connection).
    act(() => {
      vi.advanceTimersByTime(31 * 60 * 1000);
    });

    expect(result.current.filteredDxSpots).toHaveLength(0);
  });

  it('keeps a fresh spot displayed when the tick fires before it ages out', () => {
    vi.useFakeTimers();
    const socket = new StubSocket();
    const { result } = renderDxSpots(socket);

    act(() => socket.emit('dx-spot', makeSpot()));

    act(() => {
      vi.advanceTimersByTime(31_000); // one age tick, well under the 30 min maxAge
    });

    expect(result.current.filteredDxSpots).toHaveLength(1);
  });
});

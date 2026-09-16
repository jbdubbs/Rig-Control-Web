import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import AdminTab, { formatDuration, formatUptime } from './AdminTab';

describe('formatUptime', () => {
  it('formats sub-minute durations as seconds only', () => {
    expect(formatUptime(0)).toBe('0s');
    expect(formatUptime(5000)).toBe('5s');
  });

  it('formats durations under an hour as minutes and seconds', () => {
    expect(formatUptime(65000)).toBe('1m 5s');
  });

  it('formats durations of an hour or more as hours, minutes, and seconds', () => {
    expect(formatUptime(3661000)).toBe('1h 1m 1s');
    expect(formatUptime(3600000)).toBe('1h 0m 0s');
  });

  it('truncates sub-second remainders', () => {
    expect(formatUptime(1999)).toBe('1s');
  });
});

describe('formatDuration', () => {
  it('formats identically to formatUptime', () => {
    expect(formatDuration(3661000)).toBe(formatUptime(3661000));
    expect(formatDuration(5000)).toBe('5s');
  });
});

function makeFakeSocket() {
  const listeners = new Map<string, Set<(...args: any[]) => void>>();
  return {
    on: vi.fn((event: string, handler: (...args: any[]) => void) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(handler);
    }),
    off: vi.fn((event: string, handler: (...args: any[]) => void) => {
      listeners.get(event)?.delete(handler);
    }),
    emit: vi.fn(),
    __emitServerEvent(event: string, data: unknown) {
      listeners.get(event)?.forEach((h) => h(data));
    },
  } as any;
}

function seedOneUser(socket: ReturnType<typeof makeFakeSocket>) {
  act(() => {
    socket.__emitServerEvent('admin:users-list', {
      users: [{ callsign: 'N0CALL', role: 'regular', mustChangePassword: false, createdAt: '', createdBy: '' }],
    });
  });
}

describe('AdminTab mutation double-click guard', () => {
  it('does not emit a second admin:modify-user when Role is clicked again before the response arrives', () => {
    const socket = makeFakeSocket();
    render(<AdminTab socket={socket} callsign="ADMIN" />);
    seedOneUser(socket);

    const roleBtn = screen.getByTitle('Toggle role');
    fireEvent.click(roleBtn);
    fireEvent.click(roleBtn);

    const modifyCalls = socket.emit.mock.calls.filter((c: any[]) => c[0] === 'admin:modify-user');
    expect(modifyCalls.length).toBe(1);
    expect(roleBtn).toBeDisabled();
  });

  it('re-enables mutation buttons once admin:op-result arrives', () => {
    const socket = makeFakeSocket();
    render(<AdminTab socket={socket} callsign="ADMIN" />);
    seedOneUser(socket);

    const roleBtn = screen.getByTitle('Toggle role');
    fireEvent.click(roleBtn);
    expect(roleBtn).toBeDisabled();

    act(() => {
      socket.__emitServerEvent('admin:op-result', { ok: true });
    });

    expect(roleBtn).not.toBeDisabled();
  });

  it('disables an unrelated mutation button (Kick) while another operation is pending', () => {
    const socket = makeFakeSocket();
    render(<AdminTab socket={socket} callsign="ADMIN" />);
    act(() => {
      socket.__emitServerEvent('admin:sessions-list', {
        sessions: [{ socketId: 's1', callsign: 'N0CALL', role: 'regular', ip: '1.2.3.4', connectedAt: Date.now() }],
      });
    });
    seedOneUser(socket);

    fireEvent.click(screen.getByTitle('Toggle role'));

    const kickBtn = screen.getByRole('button', { name: 'Kick' });
    expect(kickBtn).toBeDisabled();

    const forceLogoutCalls = socket.emit.mock.calls.filter((c: any[]) => c[0] === 'admin:force-logout');
    fireEvent.click(kickBtn);
    expect(socket.emit.mock.calls.filter((c: any[]) => c[0] === 'admin:force-logout').length).toBe(forceLogoutCalls.length);
  });

  it('does not stay stuck disabled forever if no admin:op-result ever arrives (timeout fallback)', () => {
    vi.useFakeTimers();
    try {
      const socket = makeFakeSocket();
      render(<AdminTab socket={socket} callsign="ADMIN" />);
      seedOneUser(socket);

      const roleBtn = screen.getByTitle('Toggle role');
      fireEvent.click(roleBtn);
      expect(roleBtn).toBeDisabled();

      act(() => {
        vi.advanceTimersByTime(8000);
      });

      expect(roleBtn).not.toBeDisabled();
    } finally {
      vi.useRealTimers();
    }
  });
});

import { beforeEach, describe, expect, it } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { Socket } from 'socket.io-client';
import { checkAndClearPreferences, clearUserPreferences, NAMESPACED_KEYS, nsKey, useAuth } from './useAuth';

// Minimal stub matching only the on/off/emit surface useAuth actually uses,
// so tests exercise the hook's state machine without a real Socket.io
// connection — same pattern as useSpectrum.test.ts.
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

beforeEach(() => {
  localStorage.clear();
});

describe('nsKey', () => {
  it('uppercases the callsign and joins it with the key', () => {
    expect(nsKey('w1abc', 'foo')).toBe('W1ABC:foo');
  });
});

describe('clearUserPreferences', () => {
  it('removes every namespaced preference key for that callsign', () => {
    localStorage.setItem('W1ABC:grid-layout-v1', 'x');
    localStorage.setItem('W1ABC:console-collapsed', 'true');
    localStorage.setItem('W1ABC:prefs-cleared-at', '2026-01-01T00:00:00.000Z');

    clearUserPreferences('w1abc');

    expect(localStorage.getItem('W1ABC:grid-layout-v1')).toBeNull();
    expect(localStorage.getItem('W1ABC:console-collapsed')).toBeNull();
    expect(localStorage.getItem('W1ABC:prefs-cleared-at')).toBeNull();
  });

  it('does not touch another callsign\'s keys', () => {
    localStorage.setItem('W1ABC:console-collapsed', 'true');
    localStorage.setItem('K2XYZ:console-collapsed', 'false');

    clearUserPreferences('w1abc');

    expect(localStorage.getItem('K2XYZ:console-collapsed')).toBe('false');
  });

  // Regression test: NAMESPACED_KEYS previously only listed pre-compact/phone-split
  // legacy key names, so a preferences reset silently left most current panel
  // collapse-state and spectrum-settings keys behind. This asserts every entry in
  // the list is actually cleared, so the list can't silently drift out of sync
  // with usePanelState.ts / usePotaSpots.tsx / the spectrum panels again.
  it('clears every key currently listed in NAMESPACED_KEYS', () => {
    NAMESPACED_KEYS.forEach((key) => {
      localStorage.setItem(`W1ABC:${key}`, 'x');
    });

    clearUserPreferences('w1abc');

    NAMESPACED_KEYS.forEach((key) => {
      expect(localStorage.getItem(`W1ABC:${key}`)).toBeNull();
    });
  });
});

describe('checkAndClearPreferences', () => {
  it('clears and stamps the marker when no marker exists yet', () => {
    localStorage.setItem('W1ABC:console-collapsed', 'true');

    checkAndClearPreferences('w1abc', '2026-01-01T00:00:00.000Z');

    expect(localStorage.getItem('W1ABC:console-collapsed')).toBeNull();
    expect(localStorage.getItem('W1ABC:prefs-cleared-at')).not.toBeNull();
  });

  it('clears when the server timestamp is newer than the last-cleared marker', () => {
    localStorage.setItem('W1ABC:prefs-cleared-at', '2026-01-01T00:00:00.000Z');
    localStorage.setItem('W1ABC:console-collapsed', 'true');

    checkAndClearPreferences('w1abc', '2026-02-01T00:00:00.000Z');

    expect(localStorage.getItem('W1ABC:console-collapsed')).toBeNull();
  });

  it('does not clear when the server timestamp is older than or equal to the last-cleared marker', () => {
    localStorage.setItem('W1ABC:prefs-cleared-at', '2026-02-01T00:00:00.000Z');
    localStorage.setItem('W1ABC:console-collapsed', 'true');

    checkAndClearPreferences('w1abc', '2026-01-01T00:00:00.000Z');

    expect(localStorage.getItem('W1ABC:console-collapsed')).toBe('true');
  });
});

describe('useAuth state machine', () => {
  it('starts unknown, with no user and no error', () => {
    const socket = new StubSocket();
    const { result } = renderHook(() => useAuth(socket as unknown as Socket));

    expect(result.current.authState).toBe('unknown');
    expect(result.current.currentUser).toBeNull();
    expect(result.current.mustChangePassword).toBe(false);
    expect(result.current.loginError).toBe('');
    expect(result.current.retryAfter).toBe(0);
  });

  it('transitions to unauthenticated on auth:required', () => {
    const socket = new StubSocket();
    const { result } = renderHook(() => useAuth(socket as unknown as Socket));

    act(() => socket.emit('auth:required'));

    expect(result.current.authState).toBe('unauthenticated');
    expect(result.current.currentUser).toBeNull();
  });

  describe('auth:token-refreshed', () => {
    it('goes to must-change-password and sets the user when mustChangePassword is true', () => {
      const socket = new StubSocket();
      const { result } = renderHook(() => useAuth(socket as unknown as Socket));

      act(() =>
        socket.emit('auth:token-refreshed', {
          token: 'tok',
          callsign: 'W1ABC',
          role: 'admin',
          mustChangePassword: true,
        }),
      );

      expect(result.current.authState).toBe('must-change-password');
      expect(result.current.mustChangePassword).toBe(true);
      expect(result.current.currentUser).toEqual({ callsign: 'W1ABC', role: 'admin' });
      expect(localStorage.getItem('auth-token')).toBe('tok');
    });

    it('goes to authenticated when mustChangePassword is false or absent', () => {
      const socket = new StubSocket();
      const { result } = renderHook(() => useAuth(socket as unknown as Socket));

      act(() =>
        socket.emit('auth:token-refreshed', { token: 'tok', callsign: 'W1ABC', role: 'regular' }),
      );

      expect(result.current.authState).toBe('authenticated');
    });

    it('still transitions authState even without callsign/role, but leaves currentUser null', () => {
      const socket = new StubSocket();
      const { result } = renderHook(() => useAuth(socket as unknown as Socket));

      act(() => socket.emit('auth:token-refreshed', { token: 'tok' }));

      expect(result.current.authState).toBe('authenticated');
      expect(result.current.currentUser).toBeNull();
    });
  });

  describe('auth:result', () => {
    it('on success, sets the user, clears error/retryAfter, and honors mustChangePassword', () => {
      const socket = new StubSocket();
      const { result } = renderHook(() => useAuth(socket as unknown as Socket));

      act(() =>
        socket.emit('auth:result', {
          ok: true,
          token: 'tok',
          callsign: 'W1ABC',
          role: 'regular',
          mustChangePassword: true,
        }),
      );

      expect(result.current.authState).toBe('must-change-password');
      expect(result.current.mustChangePassword).toBe(true);
      expect(result.current.currentUser).toEqual({ callsign: 'W1ABC', role: 'regular' });
      expect(result.current.loginError).toBe('');
      expect(result.current.retryAfter).toBe(0);
    });

    it('on failure, sets loginError and retryAfter without touching authState', () => {
      const socket = new StubSocket();
      const { result } = renderHook(() => useAuth(socket as unknown as Socket));

      act(() => socket.emit('auth:result', { ok: false, error: 'Bad password', retryAfter: 5000 }));

      expect(result.current.loginError).toBe('Bad password');
      expect(result.current.retryAfter).toBe(5000);
      expect(result.current.authState).toBe('unknown');
    });

    it('defaults the error message to "Login failed" when the server omits one', () => {
      const socket = new StubSocket();
      const { result } = renderHook(() => useAuth(socket as unknown as Socket));

      act(() => socket.emit('auth:result', { ok: false }));

      expect(result.current.loginError).toBe('Login failed');
    });
  });

  it('resets to unauthenticated on auth:kicked and removes the stored token', () => {
    localStorage.setItem('auth-token', 'tok');
    const socket = new StubSocket();
    const { result } = renderHook(() => useAuth(socket as unknown as Socket));

    act(() =>
      socket.emit('auth:token-refreshed', { token: 'tok', callsign: 'W1ABC', role: 'regular' }),
    );
    expect(result.current.authState).toBe('authenticated');

    act(() => socket.emit('auth:kicked', { reason: 'logged in elsewhere' }));

    expect(result.current.authState).toBe('unauthenticated');
    expect(result.current.currentUser).toBeNull();
    expect(result.current.mustChangePassword).toBe(false);
    expect(localStorage.getItem('auth-token')).toBeNull();
  });

  describe('single-session notice (#130)', () => {
    it('sets a notice when kicked with session_replaced, and clears it on a successful login', () => {
      const socket = new StubSocket();
      const { result } = renderHook(() => useAuth(socket as unknown as Socket));

      act(() => socket.emit('auth:kicked', { reason: 'session_replaced' }));
      expect(result.current.authNotice).toMatch(/another device/);

      act(() =>
        socket.emit('auth:result', { ok: true, token: 't', callsign: 'W1ABC', role: 'regular' }),
      );
      expect(result.current.authNotice).toBeNull();
    });

    it('sets a notice when a token resume is rejected with session_elsewhere', () => {
      const socket = new StubSocket();
      const { result } = renderHook(() => useAuth(socket as unknown as Socket));

      act(() => socket.emit('auth:required', { reason: 'session_elsewhere' }));

      expect(result.current.authState).toBe('unauthenticated');
      expect(result.current.authNotice).toMatch(/another device/);
    });

    it('shows no notice for a plain logout or a bare auth:required', () => {
      const socket = new StubSocket();
      const { result } = renderHook(() => useAuth(socket as unknown as Socket));

      act(() => socket.emit('auth:kicked', { reason: 'logout' }));
      expect(result.current.authNotice).toBeNull();
      act(() => socket.emit('auth:required'));
      expect(result.current.authNotice).toBeNull();
    });
  });

  describe('connect / reconnect', () => {
    it('does not reset state on the first connect event', () => {
      const socket = new StubSocket();
      const { result } = renderHook(() => useAuth(socket as unknown as Socket));

      act(() => socket.emit('connect'));

      expect(result.current.authState).toBe('unknown');
    });

    it('resets to unknown on a subsequent connect (reconnect), regardless of prior state', () => {
      const socket = new StubSocket();
      const { result } = renderHook(() => useAuth(socket as unknown as Socket));

      act(() => socket.emit('connect')); // initial connect — ignored
      act(() =>
        socket.emit('auth:token-refreshed', { token: 'tok', callsign: 'W1ABC', role: 'regular' }),
      );
      expect(result.current.authState).toBe('authenticated');

      act(() => socket.emit('connect')); // reconnect

      expect(result.current.authState).toBe('unknown');
      expect(result.current.currentUser).toBeNull();
    });
  });

  it('login() clears loginError and emits auth:login with the credentials', () => {
    const socket = new StubSocket();
    const emitSpy: Array<[string, any]> = [];
    const originalEmit = socket.emit.bind(socket);
    socket.emit = (event: string, ...args: any[]) => {
      emitSpy.push([event, args[0]]);
      return originalEmit(event, ...args);
    };
    const { result } = renderHook(() => useAuth(socket as unknown as Socket));

    act(() => socket.emit('auth:result', { ok: false, error: 'oops' }));
    expect(result.current.loginError).toBe('oops');

    act(() => result.current.login('w1abc', 'hunter2'));

    expect(result.current.loginError).toBe('');
    expect(emitSpy).toContainEqual(['auth:login', { callsign: 'w1abc', password: 'hunter2' }]);
  });

  it('logout() emits auth:logout, clears the token, and resets state', () => {
    localStorage.setItem('auth-token', 'tok');
    const socket = new StubSocket();
    const { result } = renderHook(() => useAuth(socket as unknown as Socket));

    act(() =>
      socket.emit('auth:token-refreshed', { token: 'tok', callsign: 'W1ABC', role: 'regular' }),
    );
    act(() => result.current.logout());

    expect(result.current.authState).toBe('unauthenticated');
    expect(result.current.currentUser).toBeNull();
    expect(result.current.mustChangePassword).toBe(false);
    expect(localStorage.getItem('auth-token')).toBeNull();
  });

  it('onPasswordChanged() clears the forced-change flag and marks authenticated', () => {
    const socket = new StubSocket();
    const { result } = renderHook(() => useAuth(socket as unknown as Socket));

    act(() =>
      socket.emit('auth:token-refreshed', {
        token: 'tok',
        callsign: 'W1ABC',
        role: 'regular',
        mustChangePassword: true,
      }),
    );
    expect(result.current.authState).toBe('must-change-password');

    act(() => result.current.onPasswordChanged());

    expect(result.current.mustChangePassword).toBe(false);
    expect(result.current.authState).toBe('authenticated');
  });
});

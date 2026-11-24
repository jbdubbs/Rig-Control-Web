// @vitest-environment node
import fs from 'fs';
import os from 'os';
import path from 'path';
import jwt from 'jsonwebtoken';
import { describe, expect, it, vi } from 'vitest';
import { displaceOtherSessions, isSessionHeldElsewhere, issueToken, requireAdmin, requireAuth } from './auth.ts';

function fakeSocket(id = 'socket-1') {
  return { id, emit: vi.fn() } as any;
}

function fakeCtx(authenticatedSockets: Map<string, any> = new Map()) {
  return { authenticatedSockets, jwtSecret: 'test-secret' } as any;
}

describe('requireAuth', () => {
  it('calls the handler with the authInfo when the socket is authenticated', () => {
    const authInfo = { callsign: 'W1ABC', role: 'regular', connectedAt: 0, ip: '127.0.0.1' };
    const socket = fakeSocket();
    const ctx = fakeCtx(new Map([[socket.id, authInfo]]));
    const handler = vi.fn();

    requireAuth(socket, ctx, handler);

    expect(handler).toHaveBeenCalledWith(authInfo);
    expect(socket.emit).not.toHaveBeenCalled();
  });

  it('emits auth:required and does not call the handler when unauthenticated', () => {
    const socket = fakeSocket();
    const ctx = fakeCtx();
    const handler = vi.fn();

    requireAuth(socket, ctx, handler);

    expect(handler).not.toHaveBeenCalled();
    expect(socket.emit).toHaveBeenCalledWith('auth:required');
  });
});

describe('requireAdmin', () => {
  it('calls the handler when the socket is an authenticated admin', () => {
    const authInfo = { callsign: 'ADMIN', role: 'admin', connectedAt: 0, ip: '127.0.0.1' };
    const socket = fakeSocket();
    const ctx = fakeCtx(new Map([[socket.id, authInfo]]));
    const handler = vi.fn();

    requireAdmin(socket, ctx, handler);

    expect(handler).toHaveBeenCalledWith(authInfo);
  });

  it('emits auth:required and does not call the handler when unauthenticated', () => {
    const socket = fakeSocket();
    const ctx = fakeCtx();
    const handler = vi.fn();

    requireAdmin(socket, ctx, handler);

    expect(handler).not.toHaveBeenCalled();
    expect(socket.emit).toHaveBeenCalledWith('auth:required');
  });

  it('emits auth:error and does not call the handler for a non-admin role', () => {
    const authInfo = { callsign: 'W1ABC', role: 'regular', connectedAt: 0, ip: '127.0.0.1' };
    const socket = fakeSocket();
    const ctx = fakeCtx(new Map([[socket.id, authInfo]]));
    const handler = vi.fn();

    requireAdmin(socket, ctx, handler);

    expect(handler).not.toHaveBeenCalled();
    expect(socket.emit).toHaveBeenCalledWith('auth:error', { error: 'Forbidden' });
  });
});

describe('issueToken', () => {
  it('signs a JWT carrying the callsign and role, expiring in ~7 days', () => {
    const ctx = fakeCtx();

    const token = issueToken('W1ABC', 'admin', ctx);
    const payload = jwt.verify(token, ctx.jwtSecret) as jwt.JwtPayload;

    expect(payload.sub).toBe('W1ABC');
    expect((payload as any).role).toBe('admin');
    expect(payload.iat).toBeTypeOf('number');
    expect(payload.exp).toBeTypeOf('number');
    const lifetimeSeconds = payload.exp! - payload.iat!;
    expect(lifetimeSeconds).toBe(7 * 24 * 60 * 60);
  });

  it('produces a token that fails verification against a different secret', () => {
    const ctx = fakeCtx();
    const token = issueToken('W1ABC', 'regular', ctx);

    expect(() => jwt.verify(token, 'wrong-secret')).toThrow();
  });
});

describe('single-session limit (#130)', () => {
  function sessionCtx(enabled: boolean, entries: [string, any][]) {
    const emit = vi.fn();
    const ctx = {
      authenticatedSockets: new Map(entries),
      singleSessionPerUser: enabled,
      dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'rcw-auth-test-')),
      io: { to: vi.fn(() => ({ emit })), in: vi.fn(() => ({ socketsLeave: vi.fn() })) },
      releaseSocketResources: vi.fn(),
    } as any;
    return { ctx, emit };
  }
  const sess = (callsign: string, clientId: string, role = 'regular', connectedAt = 0) =>
    ({ callsign, role, connectedAt, ip: '10.0.0.1', clientId });

  it('displaces other-client sessions of the same callsign and keeps same-client tabs', () => {
    const { ctx, emit } = sessionCtx(true, [
      ['old', sess('W1ABC', 'client-a')],
      ['tab2', sess('W1ABC', 'client-b')],
      ['other', sess('K2XYZ', 'client-a')],
    ]);

    displaceOtherSessions(ctx, 'W1ABC', 'regular', 'client-b', '10.0.0.2');

    expect(ctx.authenticatedSockets.has('old')).toBe(false);
    expect(ctx.authenticatedSockets.has('tab2')).toBe(true);
    expect(ctx.authenticatedSockets.has('other')).toBe(true);
    expect(emit).toHaveBeenCalledWith('auth:kicked', { reason: 'session_replaced' });
    expect(ctx.releaseSocketResources).toHaveBeenCalledWith('old', 'client-a');
    expect(ctx.releaseSocketResources).toHaveBeenCalledTimes(1);
  });

  it('is a no-op when the limit is off', () => {
    const { ctx } = sessionCtx(false, [['old', sess('W1ABC', 'client-a')]]);
    displaceOtherSessions(ctx, 'W1ABC', 'regular', 'client-b', '10.0.0.2');
    expect(ctx.authenticatedSockets.has('old')).toBe(true);
  });

  it('exempts admins', () => {
    const { ctx } = sessionCtx(true, [['old', sess('ADMIN', 'client-a', 'admin')]]);
    displaceOtherSessions(ctx, 'ADMIN', 'admin', 'client-b', '10.0.0.2');
    expect(ctx.authenticatedSockets.has('old')).toBe(true);
    expect(isSessionHeldElsewhere(ctx, 'ADMIN', 'admin', 'client-b')).toBe(false);
  });

  it('rejects a token resume only when a different client holds the session', () => {
    const { ctx } = sessionCtx(true, [['s1', sess('W1ABC', 'client-a')]]);
    expect(isSessionHeldElsewhere(ctx, 'W1ABC', 'regular', 'client-b')).toBe(true);
    expect(isSessionHeldElsewhere(ctx, 'W1ABC', 'regular', 'client-a')).toBe(false);
    expect(isSessionHeldElsewhere(ctx, 'K2XYZ', 'regular', 'client-b')).toBe(false);
    ctx.singleSessionPerUser = false;
    expect(isSessionHeldElsewhere(ctx, 'W1ABC', 'regular', 'client-b')).toBe(false);
  });
});

// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { parseDxSpotLine, pruneBuffer, resolveSpotTime } from './dxCluster.ts';
import type { DxSpot, ServerContext } from './context.ts';

// A fixed "now" so day-boundary logic in resolveSpotTime is deterministic:
// 2026-06-15 13:00:00 UTC — after every HHMM used in the spot-line fixtures
// below, so none of them accidentally trip the future-rollback rule.
const NOW = Date.UTC(2026, 5, 15, 13, 0, 0);

describe('resolveSpotTime', () => {
  it('resolves an HHMM earlier today to today at that time', () => {
    const t = resolveSpotTime('1030', NOW);
    expect(new Date(t).toISOString()).toBe('2026-06-15T10:30:00.000Z');
  });

  it('rolls back a day when the HHMM would otherwise land in the future', () => {
    // "now" is just after midnight; a spot timestamped 23:58 must be yesterday.
    const justAfterMidnight = Date.UTC(2026, 5, 15, 0, 5, 0);
    const t = resolveSpotTime('2358', justAfterMidnight);
    expect(new Date(t).toISOString()).toBe('2026-06-14T23:58:00.000Z');
  });
});

describe('parseDxSpotLine', () => {
  it('parses a standard DX de spot line', () => {
    const line = 'DX de W3LPL:     14025.0  JA1ABC       CQ CQ NA                    1234Z';
    const spot = parseDxSpotLine(line, NOW);
    expect(spot).not.toBeNull();
    expect(spot!.spotter).toBe('W3LPL');
    expect(spot!.dxCall).toBe('JA1ABC');
    expect(spot!.frequency).toBeCloseTo(14025.0);
    expect(spot!.comment).toBe('CQ CQ NA');
    expect(spot!.id).toBe('W3LPL-JA1ABC-14025.0-1234');
    expect(new Date(spot!.spotTime).toISOString()).toBe('2026-06-15T12:34:00.000Z');
  });

  it('parses a spot line with a trailing grid locator', () => {
    const line = 'DX de VE3EID:    7188.0   VP8STI       QSX 7190 UP                 0230Z JN12';
    const spot = parseDxSpotLine(line, NOW);
    expect(spot).not.toBeNull();
    expect(spot!.spotter).toBe('VE3EID');
    expect(spot!.dxCall).toBe('VP8STI');
    expect(spot!.comment).toBe('QSX 7190 UP');
  });

  it('parses a spot with an empty comment', () => {
    const line = 'DX de K1TTT:     21200.0  FT5ZM                                     1500Z';
    const spot = parseDxSpotLine(line, NOW);
    expect(spot).not.toBeNull();
    expect(spot!.dxCall).toBe('FT5ZM');
    expect(spot!.comment).toBe('');
  });

  it('parses callsigns containing a slash', () => {
    const line = 'DX de N4XXX:     14195.0  KH0/W1ABC    LSB                          0300Z';
    const spot = parseDxSpotLine(line, NOW);
    expect(spot).not.toBeNull();
    expect(spot!.dxCall).toBe('KH0/W1ABC');
  });

  it('matches case-insensitively', () => {
    const line = 'dx de w3lpl:     14025.0  ja1abc       cq                          1234Z';
    const spot = parseDxSpotLine(line, NOW);
    expect(spot).not.toBeNull();
    expect(spot!.spotter).toBe('W3LPL');
    expect(spot!.dxCall).toBe('JA1ABC');
  });

  it('strips a trailing CRLF', () => {
    const line = 'DX de W3LPL:     14025.0  JA1ABC       CQ                          1234Z\r\n';
    expect(parseDxSpotLine(line, NOW)).not.toBeNull();
  });

  it('strips trailing BEL characters (real W3LPL "bells" a spot)', () => {
    // Captured verbatim from a live W3LPL feed — two BEL (\x07) bytes after
    // the timestamp, no locator, empty-looking gap where the comment would be.
    const line = 'DX de N8TW:      10138.0  VA7NRC                                      0021Z\x07\x07\r';
    const spot = parseDxSpotLine(line, NOW);
    expect(spot).not.toBeNull();
    expect(spot!.spotter).toBe('N8TW');
    expect(spot!.dxCall).toBe('VA7NRC');
    expect(spot!.frequency).toBeCloseTo(10138.0);
  });

  it('strips ANSI color escape sequences', () => {
    const line = '\x1b[1;33mDX de W3LPL:     14025.0  JA1ABC       CQ                    1234Z\x1b[0m';
    const spot = parseDxSpotLine(line, NOW);
    expect(spot).not.toBeNull();
    expect(spot!.spotter).toBe('W3LPL');
    expect(spot!.dxCall).toBe('JA1ABC');
  });

  it('rejects WWV/WCY propagation announcement lines', () => {
    const line = 'WWV de W3NGS <18>:   SFI=120, A=5, K=2, No Storms -> No Storms      1230Z';
    expect(parseDxSpotLine(line, NOW)).toBeNull();
  });

  it('rejects the login prompt', () => {
    expect(parseDxSpotLine('login: ', NOW)).toBeNull();
    expect(parseDxSpotLine('Please enter your call:', NOW)).toBeNull();
  });

  it('rejects a spot line missing the HHMMZ timestamp', () => {
    const line = 'DX de W3LPL:     14025.0  JA1ABC       CQ CQ NA';
    expect(parseDxSpotLine(line, NOW)).toBeNull();
  });

  it('rejects a line with a non-numeric frequency', () => {
    const line = 'DX de W3LPL:     ABCDE     JA1ABC       CQ                          1234Z';
    expect(parseDxSpotLine(line, NOW)).toBeNull();
  });

  it('rejects an empty line', () => {
    expect(parseDxSpotLine('', NOW)).toBeNull();
    expect(parseDxSpotLine('   ', NOW)).toBeNull();
  });
});

function makeSpot(id: string, spotTime: number): DxSpot {
  return { id, spotTime, spotter: 'W3LPL', dxCall: 'JA1ABC', frequency: 14025.0, comment: '' };
}

// pruneBuffer only needs these two fields — cast rather than construct a full
// ServerContext (which pulls in sockets/child processes irrelevant here).
function makeCtx(spots: DxSpot[], maxAge: number): ServerContext {
  return {
    dxSpotBuffer: spots,
    dxClusterSettings: { maxAge } as ServerContext['dxClusterSettings'],
  } as ServerContext;
}

describe('pruneBuffer', () => {
  it('drops entries older than dxClusterSettings.maxAge', () => {
    const now = Date.UTC(2026, 5, 15, 13, 0, 0);
    const ctx = makeCtx(
      [
        makeSpot('fresh', now - 5 * 60 * 1000), // 5 min old
        makeSpot('stale', now - 45 * 60 * 1000), // 45 min old
      ],
      30, // maxAge minutes
    );
    const realNow = Date.now;
    Date.now = () => now;
    try {
      pruneBuffer(ctx);
    } finally {
      Date.now = realNow;
    }
    expect(ctx.dxSpotBuffer.map(s => s.id)).toEqual(['fresh']);
  });

  it('caps the buffer at MAX_BUFFER_SPOTS, keeping the most recent', () => {
    const now = Date.now();
    const spots = Array.from({ length: 310 }, (_, i) => makeSpot(`s${i}`, now));
    const ctx = makeCtx(spots, 30);
    pruneBuffer(ctx);
    expect(ctx.dxSpotBuffer.length).toBe(300);
    expect(ctx.dxSpotBuffer[ctx.dxSpotBuffer.length - 1].id).toBe('s309');
  });
});

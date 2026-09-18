import net from "net";
import type { ServerContext, DxSpot } from "./context.ts";
import { vlogDx } from "./vlog.ts";

const RECONNECT_DELAY_MS = 10000;
const MAX_BUFFER_SPOTS = 300;
// Public DX cluster nodes are shared, sysop-run resources — a client that
// reconnects rapidly and repeatedly reads as abusive and risks getting the
// connecting IP banned. Cap connection attempts to 3 per rolling 60s window
// (10s apart, per RECONNECT_DELAY_MS) and then require an explicit
// disable/re-enable before trying again, rather than retrying forever.
const MAX_ATTEMPTS_PER_WINDOW = 3;
const ATTEMPT_WINDOW_MS = 60000;
// Time-based buffer eviction runs on its own clock, independent of whether
// the socket is currently connected — otherwise a dropped telnet connection
// (no more "data" events, the only other place pruneBuffer() is called)
// leaves stale spots sitting in the buffer indefinitely (issue #59).
const PRUNE_INTERVAL_MS = 60000;
// Guards only the connect/login handshake window, not the connection's whole lifetime — a
// real feed can legitimately go quiet for a stretch (low-traffic node, quiet band, overnight),
// so this is disarmed (setTimeout(0)) the moment login succeeds.
const CONNECT_TIMEOUT_MS = 15000;

// Classic AR-Cluster/DXSpider spot line, unchanged across cluster software
// for decades:
//   DX de W3LPL:     14025.0  JA1ABC       CQ CQ NA                    1234Z
// Anchored on the "DX de <spotter>:" prefix and trailing "<HHMM>Z" instead of
// fixed column offsets — column widths drift slightly between cluster
// software/versions, but the whitespace-delimited field order does not.
// Verified against real-world sample lines and reference parsers
// (dh1tw/DX-Cluster-Parser, magicbug/DXClusterAPI) during design; needs a
// final check against a live node's actual output before shipping (see
// CLAUDE.md's DX Cluster Spotting section).
const SPOT_LINE_RE =
  /^DX de ([A-Za-z0-9\/\-#]+):\s+([\d.]+)\s+([A-Za-z0-9\/]+)\s*(.*?)\s*(\d{4})Z\s*[A-Za-z0-9]{0,6}\s*$/i;

const LOGIN_PROMPT_RE = /(login|call(sign)?)\s*:\s*$/i;

/** Resolves an HHMM UTC time-of-day into an epoch-ms timestamp on the most
 *  plausible day: today UTC, unless that would place the spot more than a
 *  few minutes in the future (the line arrived just after UTC midnight,
 *  referencing a time from just before it), in which case it's yesterday. */
export function resolveSpotTime(hhmm: string, now = Date.now()): number {
  const h = parseInt(hhmm.slice(0, 2), 10);
  const m = parseInt(hhmm.slice(2, 4), 10);
  const d = new Date(now);
  const candidate = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), h, m, 0, 0);
  if (candidate - now > 5 * 60 * 1000) {
    return candidate - 24 * 60 * 60 * 1000;
  }
  return candidate;
}

// ANSI CSI escape sequences (some nodes color-code spots) followed by any
// remaining C0 control character or DEL — confirmed against a real W3LPL
// feed, which appends BEL (\x07, the terminal "ring the bell for a spot you
// might care about" convention) after the timestamp on every spot line.
// Without stripping these, the trailing bytes fall outside what the spot
// regex allows and the whole line silently fails to match.
const CONTROL_CHARS_RE = /\x1b\[[0-9;]*[A-Za-z]|[\x00-\x1f\x7f]/g;

/** Pure line parser — exported for unit testing. Returns null for anything
 *  that isn't a "DX de" spot line (WWV/WCY, announcements, prompts, MOTD). */
export function parseDxSpotLine(rawLine: string, now = Date.now()): DxSpot | null {
  const line = rawLine.replace(CONTROL_CHARS_RE, "").trim();
  const m = SPOT_LINE_RE.exec(line);
  if (!m) return null;

  const [, spotter, freqStr, dxCall, comment, hhmm] = m;
  const frequency = parseFloat(freqStr);
  if (!Number.isFinite(frequency) || frequency <= 0) return null;

  const spotTime = resolveSpotTime(hhmm, now);
  return {
    id: `${spotter}-${dxCall}-${freqStr}-${hhmm}`,
    spotTime,
    spotter: spotter.toUpperCase(),
    dxCall: dxCall.toUpperCase(),
    frequency,
    comment: comment.trim(),
  };
}

export function pruneBuffer(ctx: ServerContext): void {
  const cutoff = Date.now() - ctx.dxClusterSettings.maxAge * 60 * 1000;
  ctx.dxSpotBuffer = ctx.dxSpotBuffer.filter(s => s.spotTime >= cutoff);
  if (ctx.dxSpotBuffer.length > MAX_BUFFER_SPOTS) {
    ctx.dxSpotBuffer = ctx.dxSpotBuffer.slice(-MAX_BUFFER_SPOTS);
  }
}

function emitStatus(ctx: ServerContext): void {
  ctx.io.emit("dx-cluster-status", { connected: ctx.dxClusterConnected, error: ctx.dxClusterError });
}

export function startDxCluster(ctx: ServerContext, isRetry = false): void {
  if (ctx.dxClusterRestartTimer) {
    clearTimeout(ctx.dxClusterRestartTimer);
    ctx.dxClusterRestartTimer = null;
  }
  // Started once per enable (not per connection attempt) and left running
  // across reconnects — stopped only in stopDxCluster.
  if (!ctx.dxClusterPruneTimer) {
    ctx.dxClusterPruneTimer = setInterval(() => pruneBuffer(ctx), PRUNE_INTERVAL_MS);
  }
  if (ctx.dxClusterSocket && !ctx.dxClusterSocket.destroyed) {
    vlogDx(`[DXCLUSTER] startDxCluster called while a socket is already open — ignoring`);
    return;
  }

  // Attempt-budget gate — applies to every call, not just close-triggered
  // retries, so it also protects against a caller (e.g. a settings save)
  // invoking startDxCluster in a tight loop.
  const now = Date.now();
  if (ctx.dxClusterRetryStartedAt === null || now - ctx.dxClusterRetryStartedAt > ATTEMPT_WINDOW_MS) {
    ctx.dxClusterRetryStartedAt = now;
    ctx.dxClusterAttemptCount = 0;
  }
  ctx.dxClusterAttemptCount++;
  if (ctx.dxClusterAttemptCount > MAX_ATTEMPTS_PER_WINDOW) {
    const msg = `Gave up after ${MAX_ATTEMPTS_PER_WINDOW} connection attempts in ${Math.round(ATTEMPT_WINDOW_MS / 1000)}s — disable and re-enable DX Cluster to try again`;
    vlogDx(`[DXCLUSTER] ${msg}`);
    ctx.dxClusterConnected = false;
    ctx.dxClusterError = msg;
    emitStatus(ctx);
    return;
  }

  const { host, port, loginCallsign } = ctx.dxClusterSettings;
  vlogDx(`[DXCLUSTER] Connecting to ${host}:${port} (attempt ${ctx.dxClusterAttemptCount}/${MAX_ATTEMPTS_PER_WINDOW} this window${isRetry ? ', retry' : ''})`);
  ctx.dxClusterLoggedIn = false;

  const sock = new net.Socket();
  ctx.dxClusterSocket = sock;
  sock.setTimeout(CONNECT_TIMEOUT_MS);

  let lineBuffer = "";

  sock.on("connect", () => {
    vlogDx(`[DXCLUSTER] TCP connected to ${host}:${port}`);
  });

  sock.on("timeout", () => {
    vlogDx(`[DXCLUSTER] Connect/login timed out after ${CONNECT_TIMEOUT_MS}ms — destroying socket`);
    ctx.dxClusterError = `Timed out waiting for ${host}:${port} to respond`;
    sock.destroy();
  });

  sock.on("data", (chunk: Buffer) => {
    const text = chunk.toString("utf8");
    // JSON.stringify makes whitespace/control characters (the login prompt
    // often has no trailing newline, e.g. "login: ") visible instead of
    // silently swallowed — this is the raw evidence of what the node
    // actually said, not an assumption about what it should say.
    vlogDx(`[DXCLUSTER] Raw data (${text.length}B, loggedIn=${ctx.dxClusterLoggedIn}): ${JSON.stringify(text.slice(0, 500))}`);

    if (!ctx.dxClusterLoggedIn && LOGIN_PROMPT_RE.test(text.trim())) {
      vlogDx(`[DXCLUSTER] Login prompt detected, sending callsign`);
      sock.write(`${loginCallsign || "N0CALL"}\r\n`);
      ctx.dxClusterLoggedIn = true;
      ctx.dxClusterConnected = true;
      ctx.dxClusterError = null;
      sock.setTimeout(0); // handshake complete — a quiet feed afterward isn't a failure
      // A successful login is a real, working connection — reset the
      // attempt budget so a later drop (hours from now) isn't penalized by
      // attempts spent getting this connection established.
      ctx.dxClusterRetryStartedAt = null;
      ctx.dxClusterAttemptCount = 0;
      emitStatus(ctx);
      return;
    }

    lineBuffer += text;
    let idx: number;
    while ((idx = lineBuffer.indexOf("\n")) !== -1) {
      const line = lineBuffer.slice(0, idx);
      lineBuffer = lineBuffer.slice(idx + 1);
      if (!line.trim()) continue;

      const spot = parseDxSpotLine(line);
      if (!spot) {
        // MOTD/banner text, node announcements, or a login rejection all
        // land here — surfacing them is the whole point of this debug flag.
        vlogDx(`[DXCLUSTER] Unparsed line: ${JSON.stringify(line.slice(0, 300))}`);
        continue;
      }

      ctx.dxSpotBuffer.push(spot);
      pruneBuffer(ctx);
      ctx.io.emit("dx-spot", spot);
    }
  });

  sock.on("error", (err: NodeJS.ErrnoException) => {
    vlogDx(`[DXCLUSTER] Socket error: ${err.message}`);
    ctx.dxClusterError = err.message;
  });

  sock.on("close", (hadError) => {
    vlogDx(`[DXCLUSTER] Connection closed (hadError=${hadError}, wasLoggedIn=${ctx.dxClusterLoggedIn})`);
    ctx.dxClusterConnected = false;
    ctx.dxClusterLoggedIn = false;
    if (ctx.dxClusterSocket === sock) {
      ctx.dxClusterSocket = null;
    }
    emitStatus(ctx);

    if (!ctx.dxClusterSettings.enabled) return;
    // The attempt-budget check lives in startDxCluster() itself, so this
    // just schedules the next try — it'll be refused there once the budget
    // is exhausted.
    vlogDx(`[DXCLUSTER] Retrying in ${RECONNECT_DELAY_MS}ms`);
    ctx.dxClusterRestartTimer = setTimeout(() => {
      ctx.dxClusterRestartTimer = null;
      if (ctx.dxClusterSettings.enabled) {
        startDxCluster(ctx, true);
      }
    }, RECONNECT_DELAY_MS);
  });

  sock.connect(port, host);
}

export function stopDxCluster(ctx: ServerContext, reason = "stop requested"): void {
  if (ctx.dxClusterRestartTimer) {
    clearTimeout(ctx.dxClusterRestartTimer);
    ctx.dxClusterRestartTimer = null;
  }
  if (ctx.dxClusterPruneTimer) {
    clearInterval(ctx.dxClusterPruneTimer);
    ctx.dxClusterPruneTimer = null;
  }
  // Deliberately does NOT reset the attempt-budget window/count: a stop is
  // frequently immediately followed by a start (e.g. re-applying a changed
  // host/port while still enabled), and if stop reset the budget every time,
  // a caller invoking stop+start in a tight loop would never actually hit
  // the cap — defeating the whole point of the budget. The window only
  // clears itself after 60s of real time, or early on a successful login.
  if (ctx.dxClusterSocket) {
    vlogDx(`[DXCLUSTER] Stopping (${reason})`);
    ctx.dxClusterSocket.destroy();
    ctx.dxClusterSocket = null;
  }
  ctx.dxClusterConnected = false;
  ctx.dxClusterLoggedIn = false;
  ctx.dxClusterError = null;
  emitStatus(ctx);
}

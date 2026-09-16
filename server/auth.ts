import fs from "fs";
import path from "path";
import crypto from "crypto";
import { X509Certificate } from "crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import type { Socket } from "socket.io";
import { getAppVersion } from "./context.ts";
import type { ServerContext } from "./context.ts";
import type {
  AuthenticatedSocket,
  UserRecord,
  AuditEntry,
  SessionInfo,
  UserSummary,
} from "./authTypes.ts";

interface UsersFile {
  users: UserRecord[];
}

interface AuthFile {
  jwtSecret: string;
}

interface AuditFile {
  entries: AuditEntry[];
}

// In-memory rate limiters
const loginAttempts = new Map<string, { count: number; resetAt: number }>();          // keyed by IP
const loginCallsignAttempts = new Map<string, { count: number; resetAt: number }>(); // keyed by callsign
const changePasswordAttempts = new Map<string, { count: number; resetAt: number }>(); // keyed by callsign

const RATE_LIMIT_MAX = 5;
const LOGIN_CALLSIGN_LIMIT_MAX = 10; // higher threshold — admin can unlock, IP limit is the flood guard
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const RATE_LIMIT_SWEEP_INTERVAL_MS = 5 * 60 * 1000;

function isValidRole(role: unknown): role is "admin" | "regular" {
  return role === "admin" || role === "regular";
}

// Rate-limiter entries are otherwise only removed on a successful login/password-change
// for that exact key, or an admin unlock — an attacker flooding auth:login with distinct
// callsigns/IPs would otherwise grow these Maps without bound for the life of the process.
function sweepExpiredRateLimitEntries(now: number): void {
  for (const [key, entry] of loginAttempts) {
    if (entry.resetAt <= now) loginAttempts.delete(key);
  }
  for (const [key, entry] of loginCallsignAttempts) {
    if (entry.resetAt <= now) loginCallsignAttempts.delete(key);
  }
  for (const [key, entry] of changePasswordAttempts) {
    if (entry.resetAt <= now) changePasswordAttempts.delete(key);
  }
}

// bcryptjs silently truncates at 72 bytes — enforce this as an explicit limit
// so users aren't surprised by two passwords being treated as identical.
const MAX_PASSWORD_LENGTH = 72;

// ─── File paths ───────────────────────────────────────────────────────────────

function usersFilePath(ctx: ServerContext) {
  return path.join(ctx.dataDir, "users.json");
}
function authFilePath(ctx: ServerContext) {
  return path.join(ctx.dataDir, "auth.json");
}
function auditFilePath(ctx: ServerContext) {
  return path.join(ctx.dataDir, "audit.json");
}

// ─── Secure file writer ───────────────────────────────────────────────────────

function writeSecure(filePath: string, data: string): void {
  fs.writeFileSync(filePath, data, { mode: 0o600 });
  // chmod is a no-op if the file was just created, but fixes pre-existing files
  // that were written before this guard was in place.
  try { fs.chmodSync(filePath, 0o600); } catch { /* best-effort */ }
}

// ─── User CRUD ────────────────────────────────────────────────────────────────

function loadUsers(ctx: ServerContext): UserRecord[] {
  try {
    const raw = fs.readFileSync(usersFilePath(ctx), "utf-8");
    return (JSON.parse(raw) as UsersFile).users ?? [];
  } catch {
    return [];
  }
}

function saveUsers(ctx: ServerContext, users: UserRecord[]): void {
  writeSecure(usersFilePath(ctx), JSON.stringify({ users }, null, 2));
}

// ─── Audit log ────────────────────────────────────────────────────────────────

function appendAudit(ctx: ServerContext, entry: AuditEntry): void {
  let entries: AuditEntry[] = [];
  try {
    const raw = fs.readFileSync(auditFilePath(ctx), "utf-8");
    entries = (JSON.parse(raw) as AuditFile).entries ?? [];
  } catch { /* file may not exist yet */ }
  entries.push(entry);
  if (entries.length > 1000) entries = entries.slice(-1000);
  writeSecure(auditFilePath(ctx), JSON.stringify({ entries }, null, 2));
}

function loadAudit(ctx: ServerContext): AuditEntry[] {
  try {
    const raw = fs.readFileSync(auditFilePath(ctx), "utf-8");
    return (JSON.parse(raw) as AuditFile).entries ?? [];
  } catch {
    return [];
  }
}

// ─── JWT helpers ─────────────────────────────────────────────────────────────

export function issueToken(
  callsign: string,
  role: string,
  ctx: ServerContext
): string {
  return jwt.sign({ sub: callsign, role }, ctx.jwtSecret, { expiresIn: "7d" });
}

function verifyToken(
  token: string,
  ctx: ServerContext
): { callsign: string; role: string } | null {
  try {
    const payload = jwt.verify(token, ctx.jwtSecret) as {
      sub: string;
      role: string;
    };
    return { callsign: payload.sub, role: payload.role };
  } catch {
    return null;
  }
}

export function resolveToken(
  token: string,
  ctx: ServerContext
): { callsign: string; role: "admin" | "regular"; mustChangePassword: boolean } | null {
  const payload = verifyToken(token, ctx);
  if (!payload) return null;

  const users = loadUsers(ctx);
  const user = users.find((u) => u.callsign === payload.callsign);
  if (!user) return null;

  return {
    callsign: user.callsign,
    role: user.role,
    mustChangePassword: user.mustChangePassword ?? false,
  };
}

// ─── Error guard ──────────────────────────────────────────────────────────────

// Handlers below destructure client-supplied payloads directly in their
// parameter list. Destructuring `undefined` (a malformed/missing payload)
// throws during binding; since these are async functions, that throw becomes
// a rejected Promise socket.io never awaits — an unhandled rejection that can
// crash the whole process (no global unhandledRejection handler exists).
// This wraps any such handler so a bad payload/unexpected throw is reported
// as a normal failure result instead.
function withErrorGuard<TArgs extends unknown[]>(
  socket: Socket,
  errorEvent: string,
  handler: (...args: TArgs) => void | Promise<void>
): (...args: TArgs) => Promise<void> {
  return async (...args: TArgs) => {
    try {
      await handler(...args);
    } catch (err) {
      console.error(`[AUTH] Unhandled error, emitting ${errorEvent}:`, err);
      socket.emit(errorEvent, { ok: false, error: "Internal server error" });
    }
  };
}

// ─── Auth guards ─────────────────────────────────────────────────────────────

export function requireAuth(
  socket: Socket,
  ctx: ServerContext,
  handler: (authInfo: AuthenticatedSocket) => void
): void {
  const authInfo = ctx.authenticatedSockets.get(socket.id);
  if (!authInfo) {
    socket.emit("auth:required");
    return;
  }
  handler(authInfo);
}

export function requireAdmin(
  socket: Socket,
  ctx: ServerContext,
  handler: (authInfo: AuthenticatedSocket) => void
): void {
  const authInfo = ctx.authenticatedSockets.get(socket.id);
  if (!authInfo) {
    socket.emit("auth:required");
    return;
  }
  if (authInfo.role !== "admin") {
    socket.emit("auth:error", { error: "Forbidden" });
    return;
  }
  handler(authInfo);
}

// ─── Initialization ───────────────────────────────────────────────────────────

export async function initAuth(ctx: ServerContext): Promise<void> {
  // Load or generate JWT secret
  const aPath = authFilePath(ctx);
  if (fs.existsSync(aPath)) {
    try {
      const raw = fs.readFileSync(aPath, "utf-8");
      ctx.jwtSecret = (JSON.parse(raw) as AuthFile).jwtSecret || "";
    } catch {
      ctx.jwtSecret = "";
    }
  }

  if (!ctx.jwtSecret) {
    ctx.jwtSecret = crypto.randomBytes(32).toString("hex");
    fs.writeFileSync(
      aPath,
      JSON.stringify({ jwtSecret: ctx.jwtSecret }, null, 2),
      { mode: 0o600 }
    );
    console.log("[AUTH] Generated new JWT secret");
  }

  // Seed default ADMIN user if no users file exists
  if (!fs.existsSync(usersFilePath(ctx))) {
    const passwordHash = await bcrypt.hash("admin", 12);
    const defaultUser: UserRecord = {
      callsign: "ADMIN",
      passwordHash,
      role: "admin",
      mustChangePassword: true,
      createdAt: new Date().toISOString(),
      createdBy: "system",
    };
    saveUsers(ctx, [defaultUser]);
    console.log(
      "[AUTH] Default ADMIN user created (password: admin). Change password on first login."
    );
  }

  setInterval(() => sweepExpiredRateLimitEntries(Date.now()), RATE_LIMIT_SWEEP_INTERVAL_MS).unref();
}

// ─── Auth socket handlers ─────────────────────────────────────────────────────

export function registerAuthHandlers(
  socket: Socket,
  ctx: ServerContext,
  onAuthenticated: () => void
): void {
  socket.on(
    "auth:login",
    withErrorGuard(socket, "auth:result", async ({
      callsign,
      password,
    }: {
      callsign: string;
      password: string;
    }) => {
      const ip = socket.handshake.address;
      const normalizedCallsign = (callsign ?? "").toUpperCase().trim();
      const now = Date.now();

      // IP flood guard
      const attempts = loginAttempts.get(ip);
      if (attempts && attempts.count >= RATE_LIMIT_MAX && attempts.resetAt > now) {
        socket.emit("auth:result", {
          ok: false,
          error: "Too many failed attempts. Please try again later.",
          retryAfter: attempts.resetAt - now,
        });
        return;
      }

      // Per-callsign lockout (proxy-safe; admin-unlockable)
      const callsignAttempts = loginCallsignAttempts.get(normalizedCallsign);
      if (callsignAttempts && callsignAttempts.count >= LOGIN_CALLSIGN_LIMIT_MAX && callsignAttempts.resetAt > now) {
        socket.emit("auth:result", {
          ok: false,
          error: "Too many failed attempts. Please try again later.",
          retryAfter: callsignAttempts.resetAt - now,
        });
        return;
      }

      const users = loadUsers(ctx);
      const user = users.find((u) => u.callsign === normalizedCallsign);

      if (!user) {
        // Constant-time dummy compare to avoid user enumeration via timing
        await bcrypt.compare(
          password,
          "$2b$12$invalidhashXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
        );
        recordFailedAttempt(ip, now);
        recordLoginCallsignAttempt(normalizedCallsign, now);
        appendAudit(ctx, {
          ts: new Date().toISOString(),
          event: "login_failed",
          callsign: normalizedCallsign,
          ip,
          detail: "user not found",
        });
        socket.emit("auth:result", {
          ok: false,
          error: "Invalid callsign or password",
        });
        return;
      }

      const passwordValid = await bcrypt.compare(password, user.passwordHash);
      if (!passwordValid) {
        recordFailedAttempt(ip, now);
        recordLoginCallsignAttempt(normalizedCallsign, now);
        appendAudit(ctx, {
          ts: new Date().toISOString(),
          event: "login_failed",
          callsign: normalizedCallsign,
          ip,
          detail: "bad password",
        });
        socket.emit("auth:result", {
          ok: false,
          error: "Invalid callsign or password",
        });
        return;
      }

      // Success — clear both rate limiters
      loginAttempts.delete(ip);
      loginCallsignAttempts.delete(normalizedCallsign);

      ctx.authenticatedSockets.set(socket.id, {
        callsign: user.callsign,
        role: user.role,
        connectedAt: Date.now(),
        ip,
      });

      const token = issueToken(user.callsign, user.role, ctx);
      appendAudit(ctx, {
        ts: new Date().toISOString(),
        event: "login_success",
        callsign: user.callsign,
        ip,
        detail: "",
      });

      socket.emit("auth:result", {
        ok: true,
        token,
        callsign: user.callsign,
        role: user.role,
        mustChangePassword: user.mustChangePassword ?? false,
        preferencesClearedAt: user.preferencesClearedAt ?? null,
      });

      if (!user.mustChangePassword) {
        onAuthenticated();
      }
    })
  );

  socket.on("auth:logout", () => {
    const authInfo = ctx.authenticatedSockets.get(socket.id);
    if (authInfo) {
      appendAudit(ctx, {
        ts: new Date().toISOString(),
        event: "logout",
        callsign: authInfo.callsign,
        ip: socket.handshake.address,
        detail: "",
      });
      ctx.authenticatedSockets.delete(socket.id);
    }
    socket.emit("auth:kicked", { reason: "logout" });
  });

  socket.on(
    "auth:change-password",
    withErrorGuard(socket, "auth:op-result", async ({
      currentPassword,
      newPassword,
    }: {
      currentPassword: string;
      newPassword: string;
    }) => {
      requireAuth(socket, ctx, async (authInfo) => {
        // Rate limit by callsign to prevent automated current-password guessing
        const now = Date.now();
        const cpAttempts = changePasswordAttempts.get(authInfo.callsign);
        if (cpAttempts && cpAttempts.count >= RATE_LIMIT_MAX && cpAttempts.resetAt > now) {
          socket.emit("auth:op-result", {
            ok: false,
            error: "Too many failed attempts. Try again later.",
          });
          return;
        }

        if (!newPassword || newPassword.length < 8) {
          socket.emit("auth:op-result", {
            ok: false,
            error: "Password must be at least 8 characters",
          });
          return;
        }
        if (newPassword.length > MAX_PASSWORD_LENGTH) {
          socket.emit("auth:op-result", {
            ok: false,
            error: `Password must be ${MAX_PASSWORD_LENGTH} characters or fewer`,
          });
          return;
        }
        if (newPassword === currentPassword) {
          socket.emit("auth:op-result", {
            ok: false,
            error: "New password must be different from your current password",
          });
          return;
        }

        const users = loadUsers(ctx);
        const idx = users.findIndex((u) => u.callsign === authInfo.callsign);
        if (idx === -1) {
          socket.emit("auth:op-result", { ok: false, error: "User not found" });
          return;
        }

        const valid = await bcrypt.compare(
          currentPassword,
          users[idx].passwordHash
        );
        if (!valid) {
          const existing = changePasswordAttempts.get(authInfo.callsign);
          if (!existing || existing.resetAt <= now) {
            changePasswordAttempts.set(authInfo.callsign, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
          } else {
            existing.count++;
          }
          socket.emit("auth:op-result", {
            ok: false,
            error: "Current password is incorrect",
          });
          return;
        }

        changePasswordAttempts.delete(authInfo.callsign);
        const wasMustChange = users[idx].mustChangePassword;
        users[idx].passwordHash = await bcrypt.hash(newPassword, 12);
        users[idx].mustChangePassword = false;
        saveUsers(ctx, users);
        appendAudit(ctx, {
          ts: new Date().toISOString(),
          event: "password_changed",
          callsign: authInfo.callsign,
          ip: socket.handshake.address,
          detail: "",
        });
        socket.emit("auth:op-result", { ok: true });
        if (wasMustChange) {
          onAuthenticated();
        }
      });
    })
  );
}

// ─── Admin socket handlers ────────────────────────────────────────────────────

export function registerAdminHandlers(
  socket: Socket,
  ctx: ServerContext
): void {
  socket.on("admin:get-users", () => {
    requireAdmin(socket, ctx, () => {
      const users = loadUsers(ctx);
      socket.emit("admin:users-list", { users: toUserSummaries(users) });
    });
  });

  socket.on(
    "admin:create-user",
    withErrorGuard(socket, "admin:op-result", async ({
      callsign,
      password,
      role,
    }: {
      callsign: string;
      password: string;
      role: "admin" | "regular";
    }) => {
      requireAdmin(socket, ctx, async (authInfo) => {
        const normalizedCallsign = (callsign ?? "").toUpperCase().trim();
        if (!normalizedCallsign || !password || !role) {
          socket.emit("admin:op-result", {
            ok: false,
            error: "Missing required fields",
          });
          return;
        }
        if (!isValidRole(role)) {
          socket.emit("admin:op-result", {
            ok: false,
            error: "Invalid role",
          });
          return;
        }
        if (password.length < 8) {
          socket.emit("admin:op-result", {
            ok: false,
            error: "Password must be at least 8 characters",
          });
          return;
        }
        if (password.length > MAX_PASSWORD_LENGTH) {
          socket.emit("admin:op-result", {
            ok: false,
            error: `Password must be ${MAX_PASSWORD_LENGTH} characters or fewer`,
          });
          return;
        }

        const users = loadUsers(ctx);
        if (users.find((u) => u.callsign === normalizedCallsign)) {
          socket.emit("admin:op-result", {
            ok: false,
            error: "Callsign already exists",
          });
          return;
        }

        const passwordHash = await bcrypt.hash(password, 12);
        users.push({
          callsign: normalizedCallsign,
          passwordHash,
          role,
          mustChangePassword: false,
          createdAt: new Date().toISOString(),
          createdBy: authInfo.callsign,
        });
        saveUsers(ctx, users);
        appendAudit(ctx, {
          ts: new Date().toISOString(),
          event: "user_created",
          callsign: authInfo.callsign,
          ip: socket.handshake.address,
          detail: normalizedCallsign,
        });
        socket.emit("admin:op-result", { ok: true });
        broadcastUsersList(ctx);
      });
    })
  );

  socket.on("admin:delete-user", withErrorGuard(socket, "admin:op-result", ({ callsign }: { callsign: string }) => {
    requireAdmin(socket, ctx, (authInfo) => {
      const normalizedCallsign = (callsign ?? "").toUpperCase().trim();
      if (normalizedCallsign === authInfo.callsign) {
        socket.emit("admin:op-result", {
          ok: false,
          error: "Cannot delete your own account",
        });
        return;
      }
      const users = loadUsers(ctx);
      const filtered = users.filter((u) => u.callsign !== normalizedCallsign);
      if (filtered.length === users.length) {
        socket.emit("admin:op-result", { ok: false, error: "User not found" });
        return;
      }
      saveUsers(ctx, filtered);
      appendAudit(ctx, {
        ts: new Date().toISOString(),
        event: "user_deleted",
        callsign: authInfo.callsign,
        ip: socket.handshake.address,
        detail: normalizedCallsign,
      });
      kickUserSockets(ctx, normalizedCallsign, "account_deleted");
      socket.emit("admin:op-result", { ok: true });
      broadcastUsersList(ctx);
    });
  }));

  socket.on(
    "admin:modify-user",
    withErrorGuard(socket, "admin:op-result", async ({
      callsign,
      role,
      password,
    }: {
      callsign: string;
      role?: "admin" | "regular";
      password?: string;
    }) => {
      requireAdmin(socket, ctx, async (authInfo) => {
        const normalizedCallsign = (callsign ?? "").toUpperCase().trim();
        if (role !== undefined && !isValidRole(role)) {
          socket.emit("admin:op-result", {
            ok: false,
            error: "Invalid role",
          });
          return;
        }
        if (password && password.length < 8) {
          socket.emit("admin:op-result", {
            ok: false,
            error: "Password must be at least 8 characters",
          });
          return;
        }
        if (password && password.length > MAX_PASSWORD_LENGTH) {
          socket.emit("admin:op-result", {
            ok: false,
            error: `Password must be ${MAX_PASSWORD_LENGTH} characters or fewer`,
          });
          return;
        }

        const users = loadUsers(ctx);
        const idx = users.findIndex((u) => u.callsign === normalizedCallsign);
        if (idx === -1) {
          socket.emit("admin:op-result", { ok: false, error: "User not found" });
          return;
        }

        if (role) users[idx].role = role;
        if (password) {
          users[idx].passwordHash = await bcrypt.hash(password, 12);
          users[idx].mustChangePassword = true;
        }
        saveUsers(ctx, users);
        appendAudit(ctx, {
          ts: new Date().toISOString(),
          event: "user_modified",
          callsign: authInfo.callsign,
          ip: socket.handshake.address,
          detail: normalizedCallsign,
        });
        socket.emit("admin:op-result", { ok: true });
        broadcastUsersList(ctx);
      });
    })
  );

  socket.on(
    "admin:clear-preferences",
    withErrorGuard(socket, "admin:op-result", ({ callsign }: { callsign: string }) => {
      requireAdmin(socket, ctx, (authInfo) => {
        const normalizedCallsign = (callsign ?? "").toUpperCase().trim();
        const users = loadUsers(ctx);
        const idx = users.findIndex((u) => u.callsign === normalizedCallsign);
        if (idx === -1) {
          socket.emit("admin:op-result", {
            ok: false,
            error: "User not found",
          });
          return;
        }
        users[idx].preferencesClearedAt = new Date().toISOString();
        saveUsers(ctx, users);
        appendAudit(ctx, {
          ts: new Date().toISOString(),
          event: "preferences_cleared",
          callsign: authInfo.callsign,
          ip: socket.handshake.address,
          detail: normalizedCallsign,
        });
        // Notify target user's live sockets
        ctx.authenticatedSockets.forEach((info, socketId) => {
          if (info.callsign === normalizedCallsign) {
            ctx.io.to(socketId).emit("auth:preferences-cleared");
          }
        });
        socket.emit("admin:op-result", { ok: true });
      });
    })
  );

  socket.on("admin:get-sessions", () => {
    requireAdmin(socket, ctx, () => {
      const sessions: SessionInfo[] = [];
      ctx.authenticatedSockets.forEach((info, socketId) => {
        sessions.push({
          socketId,
          callsign: info.callsign,
          role: info.role,
          ip: info.ip,
          connectedAt: info.connectedAt,
        });
      });
      socket.emit("admin:sessions-list", { sessions });
    });
  });

  socket.on(
    "admin:force-logout",
    withErrorGuard(socket, "admin:op-result", ({ socketId }: { socketId: string }) => {
      requireAdmin(socket, ctx, (authInfo) => {
        const target = ctx.authenticatedSockets.get(socketId);
        if (!target) {
          socket.emit("admin:op-result", {
            ok: false,
            error: "Session not found",
          });
          return;
        }
        appendAudit(ctx, {
          ts: new Date().toISOString(),
          event: "force_logout",
          callsign: authInfo.callsign,
          ip: socket.handshake.address,
          detail: `${target.callsign} (${socketId})`,
        });
        ctx.io.to(socketId).emit("auth:kicked", { reason: "force_logout" });
        ctx.authenticatedSockets.delete(socketId);
        socket.emit("admin:op-result", { ok: true });
      });
    })
  );

  socket.on(
    "admin:get-audit-log",
    withErrorGuard(socket, "admin:op-result", ({ limit = 50 }: { limit?: number }) => {
      requireAdmin(socket, ctx, () => {
        const safeLimit = Math.min(Math.max(1, Math.floor(Number(limit) || 50)), 1000);
        const entries = loadAudit(ctx);
        socket.emit("admin:audit-log", {
          entries: entries.slice(-safeLimit).reverse(),
        });
      });
    })
  );

  socket.on("admin:get-system-info", () => {
    requireAdmin(socket, ctx, () => {
      const version = getAppVersion(ctx.baseDir);
      let certExpiry = "unknown";

      try {
        const certPem = fs.readFileSync(
          path.join(ctx.dataDir, "server.cert.pem"),
          "utf-8"
        );
        const x509 = new X509Certificate(certPem);
        certExpiry = x509.validTo;
      } catch { /* cert not readable */ }

      socket.emit("admin:system-info", {
        version,
        uptime: Date.now() - ctx.serverStartTime,
        nodeVersion: process.version,
        certExpiry,
      });
    });
  });

  socket.on("admin:get-lockouts", () => {
    requireAdmin(socket, ctx, () => {
      const now = Date.now();
      const lockouts: { callsign: string; type: "login" | "change-password"; resetAt: number }[] = [];
      loginCallsignAttempts.forEach((data, callsign) => {
        if (data.count >= LOGIN_CALLSIGN_LIMIT_MAX && data.resetAt > now) {
          lockouts.push({ callsign, type: "login", resetAt: data.resetAt });
        }
      });
      changePasswordAttempts.forEach((data, callsign) => {
        if (data.count >= RATE_LIMIT_MAX && data.resetAt > now) {
          lockouts.push({ callsign, type: "change-password", resetAt: data.resetAt });
        }
      });
      socket.emit("admin:lockouts-list", { lockouts });
    });
  });

  socket.on("admin:unlock-callsign", withErrorGuard(socket, "admin:op-result", ({ callsign }: { callsign: string }) => {
    requireAdmin(socket, ctx, (authInfo) => {
      const normalizedCallsign = (callsign ?? "").toUpperCase().trim();
      loginCallsignAttempts.delete(normalizedCallsign);
      changePasswordAttempts.delete(normalizedCallsign);
      appendAudit(ctx, {
        ts: new Date().toISOString(),
        event: "lockout_cleared",
        callsign: authInfo.callsign,
        ip: socket.handshake.address,
        detail: normalizedCallsign,
      });
      socket.emit("admin:op-result", { ok: true });
    });
  }));

  socket.on("admin:factory-reset", withErrorGuard(socket, "admin:op-result", ({ confirm }: { confirm: boolean }) => {
    requireAdmin(socket, ctx, (authInfo) => {
      if (!confirm) {
        socket.emit("admin:op-result", {
          ok: false,
          error: "Confirmation required",
        });
        return;
      }

      appendAudit(ctx, {
        ts: new Date().toISOString(),
        event: "factory_reset",
        callsign: authInfo.callsign,
        ip: socket.handshake.address,
        detail: "",
      });

      // Kick all other authenticated sockets first
      ctx.authenticatedSockets.forEach((_, socketId) => {
        if (socketId !== socket.id) {
          ctx.io.to(socketId).emit("auth:kicked", { reason: "factory_reset" });
          ctx.authenticatedSockets.delete(socketId);
        }
      });

      // Delete both data files and rotate the JWT secret so all outstanding
      // tokens are immediately invalidated — not just the live sockets kicked above.
      try { fs.unlinkSync(usersFilePath(ctx)); } catch { /* may not exist */ }
      try { fs.unlinkSync(authFilePath(ctx)); } catch { /* may not exist */ }
      ctx.jwtSecret = "";

      initAuth(ctx).then(() => {
        socket.emit("admin:op-result", { ok: true });
        // Kick the requesting admin too — they re-login with default credentials
        socket.emit("auth:kicked", { reason: "factory_reset" });
        ctx.authenticatedSockets.delete(socket.id);
      });
    });
  }));
}

// ─── Private helpers ──────────────────────────────────────────────────────────

function recordFailedAttempt(ip: string, now: number): void {
  const existing = loginAttempts.get(ip);
  if (!existing || existing.resetAt <= now) {
    loginAttempts.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
  } else {
    existing.count++;
  }
}

function recordLoginCallsignAttempt(callsign: string, now: number): void {
  const existing = loginCallsignAttempts.get(callsign);
  if (!existing || existing.resetAt <= now) {
    loginCallsignAttempts.set(callsign, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
  } else {
    existing.count++;
  }
}

function kickUserSockets(
  ctx: ServerContext,
  callsign: string,
  reason: string
): void {
  const toKick: string[] = [];
  ctx.authenticatedSockets.forEach((info, socketId) => {
    if (info.callsign === callsign) toKick.push(socketId);
  });
  for (const socketId of toKick) {
    ctx.io.to(socketId).emit("auth:kicked", { reason });
    ctx.authenticatedSockets.delete(socketId);
  }
}

function toUserSummaries(users: UserRecord[]): UserSummary[] {
  return users.map(({ callsign, role, mustChangePassword, createdAt, createdBy }) => ({
    callsign,
    role,
    mustChangePassword,
    createdAt,
    createdBy,
  }));
}

function broadcastUsersList(ctx: ServerContext): void {
  const users = loadUsers(ctx);
  const summaries = toUserSummaries(users);
  ctx.authenticatedSockets.forEach((info, socketId) => {
    if (info.role === "admin") {
      ctx.io.to(socketId).emit("admin:users-list", { users: summaries });
    }
  });
}

import React, { useState, useEffect, useCallback, useRef } from "react";
import type { Socket } from "socket.io-client";
import { cn } from "../utils";

interface UserSummary {
  callsign: string;
  role: "admin" | "regular";
  mustChangePassword: boolean;
  createdAt: string;
  createdBy: string;
}

interface SessionInfo {
  socketId: string;
  callsign: string;
  role: string;
  ip: string;
  connectedAt: number;
}

interface AuditEntry {
  ts: string;
  event: string;
  callsign: string;
  ip: string;
  detail: string;
}

interface SystemInfo {
  version: string;
  uptime: number;
  nodeVersion: string;
  certExpiry: string;
}

interface LockoutEntry {
  callsign: string;
  type: "login" | "change-password";
  resetAt: number;
}

// Matches the "[HH:MM:SS.mmm]"-style precision of server/vlog.ts's verbose
// logging, but with a leading date — audit entries persist across days, so
// a bare time (the previous behavior) gave the admin no way to tell which
// day an entry happened on.
function formatAuditTimestamp(ts: string): string {
  const d = new Date(ts);
  const pad = (n: number, len = 2) => n.toString().padStart(len, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

interface Props {
  socket: Socket | null;
  callsign: string;
}

export function formatUptime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m ${sec}s`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

export function formatDuration(ms: number): string {
  return formatUptime(ms);
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-3">
      <h3 className="text-[0.625rem] uppercase text-emerald-500 font-bold border-b border-emerald-500/20 pb-1">
        {title}
      </h3>
      {children}
    </div>
  );
}

export default function AdminTab({ socket, callsign }: Props) {
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [lockouts, setLockouts] = useState<LockoutEntry[]>([]);
  const [auditLog, setAuditLog] = useState<AuditEntry[]>([]);
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [opError, setOpError] = useState("");
  const [opSuccess, setOpSuccess] = useState("");
  // Guards every privileged/destructive mutation button below against a rapid double-click
  // firing a duplicate socket emit before the first admin:op-result response arrives (e.g.
  // two overlapping factory-reset or create-user requests). Cleared by the shared
  // onOpResult handler, with a timeout fallback in case a response never arrives at all
  // (session expired mid-request, socket drop) so the panel can't get stuck disabled forever.
  const [opPending, setOpPending] = useState(false);
  const opPendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Add user form
  const [newCallsign, setNewCallsign] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState<"admin" | "regular">("regular");
  const [showAddUser, setShowAddUser] = useState(false);

  // Reset password form
  const [resetPwTarget, setResetPwTarget] = useState<string | null>(null);
  const [resetPwValue, setResetPwValue] = useState("");

  // Factory reset
  const [resetConfirmText, setResetConfirmText] = useState("");
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  // Clear prefs
  const [clearPrefsTarget, setClearPrefsTarget] = useState("");

  const showOp = (msg: string, isError: boolean) => {
    if (isError) { setOpError(msg); setOpSuccess(""); }
    else { setOpSuccess(msg); setOpError(""); }
    setTimeout(() => { setOpError(""); setOpSuccess(""); }, 4000);
  };

  const beginOp = () => {
    setOpPending(true);
    if (opPendingTimerRef.current) clearTimeout(opPendingTimerRef.current);
    opPendingTimerRef.current = setTimeout(() => setOpPending(false), 8000);
  };

  const fetchAll = useCallback(() => {
    socket?.emit("admin:get-users");
    socket?.emit("admin:get-sessions");
    socket?.emit("admin:get-lockouts");
    socket?.emit("admin:get-audit-log", { limit: 50 });
    socket?.emit("admin:get-system-info");
  }, [socket]);

  useEffect(() => {
    if (!socket) return;

    fetchAll();

    const sessionInterval = setInterval(() => {
      socket.emit("admin:get-sessions");
    }, 15000);

    const onUsers = ({ users }: { users: UserSummary[] }) => setUsers(users);
    const onSessions = ({ sessions }: { sessions: SessionInfo[] }) => setSessions(sessions);
    const onLockouts = ({ lockouts }: { lockouts: LockoutEntry[] }) => setLockouts(lockouts);
    const onAudit = ({ entries }: { entries: AuditEntry[] }) => setAuditLog(entries);
    const onSystemInfo = (info: SystemInfo) => setSystemInfo(info);
    const onOpResult = ({ ok, error }: { ok: boolean; error?: string }) => {
      if (opPendingTimerRef.current) { clearTimeout(opPendingTimerRef.current); opPendingTimerRef.current = null; }
      setOpPending(false);
      showOp(ok ? "Done" : (error ?? "Error"), !ok);
      if (ok) fetchAll();
    };

    socket.on("admin:users-list", onUsers);
    socket.on("admin:sessions-list", onSessions);
    socket.on("admin:lockouts-list", onLockouts);
    socket.on("admin:audit-log", onAudit);
    socket.on("admin:system-info", onSystemInfo);
    socket.on("admin:op-result", onOpResult);

    return () => {
      clearInterval(sessionInterval);
      if (opPendingTimerRef.current) clearTimeout(opPendingTimerRef.current);
      socket.off("admin:users-list", onUsers);
      socket.off("admin:sessions-list", onSessions);
      socket.off("admin:lockouts-list", onLockouts);
      socket.off("admin:audit-log", onAudit);
      socket.off("admin:system-info", onSystemInfo);
      socket.off("admin:op-result", onOpResult);
    };
  }, [socket, fetchAll]);

  const handleCreateUser = () => {
    if (opPending || !newCallsign.trim() || !newPassword) return;
    beginOp();
    socket?.emit("admin:create-user", {
      callsign: newCallsign.trim().toUpperCase(),
      password: newPassword,
      role: newRole,
    });
    setNewCallsign("");
    setNewPassword("");
    setNewRole("regular");
    setShowAddUser(false);
  };

  const handleDeleteUser = (target: string) => {
    if (opPending) return;
    if (!confirm(`Delete user ${target}?`)) return;
    beginOp();
    socket?.emit("admin:delete-user", { callsign: target });
  };

  const handleResetPassword = (target: string) => {
    setResetPwTarget(target);
    setResetPwValue("");
  };

  const handleConfirmResetPassword = () => {
    if (opPending || !resetPwTarget || resetPwValue.length < 8) return;
    beginOp();
    socket?.emit("admin:modify-user", { callsign: resetPwTarget, password: resetPwValue });
    setResetPwTarget(null);
    setResetPwValue("");
  };

  const handleChangeRole = (target: string, currentRole: "admin" | "regular") => {
    if (opPending) return;
    beginOp();
    const newRoleVal = currentRole === "admin" ? "regular" : "admin";
    socket?.emit("admin:modify-user", { callsign: target, role: newRoleVal });
  };

  const handleForceLogout = (socketId: string) => {
    if (opPending) return;
    beginOp();
    socket?.emit("admin:force-logout", { socketId });
  };

  const handleUnlockCallsign = (target: string) => {
    if (opPending) return;
    beginOp();
    socket?.emit("admin:unlock-callsign", { callsign: target });
  };

  const handleClearPrefs = () => {
    if (opPending || !clearPrefsTarget) return;
    beginOp();
    socket?.emit("admin:clear-preferences", { callsign: clearPrefsTarget });
    setClearPrefsTarget("");
  };

  const handleFactoryReset = () => {
    if (opPending || resetConfirmText !== "RESET") return;
    beginOp();
    socket?.emit("admin:factory-reset", { confirm: true });
    setShowResetConfirm(false);
    setResetConfirmText("");
  };

  const inputClass =
    "w-full bg-[#0a0a0a] border border-[#2a2b2e] rounded px-2 py-1.5 text-xs font-mono text-white focus:outline-none focus:border-emerald-600 transition-colors";
  const btnClass =
    "px-3 py-1 rounded text-xs font-bold uppercase tracking-wide transition-all";

  return (
    <div className="p-6 space-y-6 max-h-[70vh] overflow-y-auto">
      {(opError || opSuccess) && (
        <div
          className={cn(
            "rounded-lg px-3 py-2 text-xs font-mono border",
            opError
              ? "bg-red-500/10 border-red-500/30 text-red-400"
              : "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
          )}
        >
          {opError || opSuccess}
        </div>
      )}

      {/* ── User Management ─────────────────────────────────────────── */}
      <Section title="User Management">
        <div className="space-y-1">
          {users.map((u) => (
            <div
              key={u.callsign}
              className="flex flex-col sm:flex-row sm:items-center sm:justify-between bg-[#0a0a0a] border border-[#2a2b2e] rounded px-3 py-2 gap-2"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-xs font-mono font-bold text-white truncate">
                  {u.callsign}
                </span>
                <span
                  className={cn(
                    "text-[0.6rem] font-bold uppercase px-1.5 py-0.5 rounded border",
                    u.role === "admin"
                      ? "text-amber-400 border-amber-500/40 bg-amber-500/10"
                      : "text-[#8e9299] border-[#2a2b2e]"
                  )}
                >
                  {u.role}
                </span>
                {u.mustChangePassword && (
                  <span className="text-[0.6rem] text-orange-400">pw reset</span>
                )}
              </div>
              <div className="grid grid-cols-3 gap-1 sm:flex sm:items-center sm:flex-shrink-0">
                <button
                  onClick={() => handleChangeRole(u.callsign, u.role)}
                  disabled={u.callsign === callsign || opPending}
                  className={cn(btnClass, "bg-[#1a1b1e] text-[#8e9299] hover:text-white border border-[#2a2b2e] disabled:opacity-30 disabled:cursor-not-allowed")}
                  title="Toggle role"
                >
                  Role
                </button>
                <button
                  onClick={() => handleResetPassword(u.callsign)}
                  className={cn(btnClass, "bg-[#1a1b1e] text-[#8e9299] hover:text-white border border-[#2a2b2e]")}
                >
                  Reset PW
                </button>
                <button
                  onClick={() => handleDeleteUser(u.callsign)}
                  disabled={u.callsign === callsign || opPending}
                  className={cn(btnClass, "bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/30 disabled:opacity-30 disabled:cursor-not-allowed")}
                >
                  Del
                </button>
              </div>
            </div>
          ))}
        </div>

        {resetPwTarget && (
          <div className="bg-[#0a0a0a] border border-[#2a2b2e] rounded-lg p-3 space-y-2">
            <p className="text-[0.625rem] uppercase font-bold text-[#8e9299]">
              Reset Password — {resetPwTarget}
            </p>
            <input
              type="password"
              placeholder="New password (min 8 chars)"
              value={resetPwValue}
              onChange={(e) => setResetPwValue(e.target.value)}
              autoComplete="new-password"
              className={inputClass}
            />
            <div className="flex gap-2">
              <button
                onClick={handleConfirmResetPassword}
                disabled={resetPwValue.length < 8 || opPending}
                className={cn(btnClass, "flex-1 bg-emerald-600 hover:bg-emerald-500 text-white border border-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed")}
              >
                Save
              </button>
              <button
                onClick={() => { setResetPwTarget(null); setResetPwValue(""); }}
                className={cn(btnClass, "flex-1 bg-[#1a1b1e] text-[#8e9299] border border-[#2a2b2e]")}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {showAddUser ? (
          <div className="bg-[#0a0a0a] border border-[#2a2b2e] rounded-lg p-3 space-y-2">
            <p className="text-[0.625rem] uppercase font-bold text-[#8e9299]">Add User</p>
            <input
              type="text"
              placeholder="Callsign"
              value={newCallsign}
              onChange={(e) => setNewCallsign(e.target.value.toUpperCase())}
              className={inputClass}
            />
            <input
              type="password"
              placeholder="Password (min 8 chars)"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className={inputClass}
            />
            <select
              value={newRole}
              onChange={(e) => setNewRole(e.target.value as "admin" | "regular")}
              className={inputClass}
            >
              <option value="regular">Regular</option>
              <option value="admin">Admin</option>
            </select>
            <div className="flex gap-2">
              <button
                onClick={handleCreateUser}
                disabled={!newCallsign.trim() || newPassword.length < 8 || opPending}
                className={cn(btnClass, "flex-1 bg-emerald-600 hover:bg-emerald-500 text-white border border-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed")}
              >
                Create
              </button>
              <button
                onClick={() => { setShowAddUser(false); setNewCallsign(""); setNewPassword(""); }}
                className={cn(btnClass, "flex-1 bg-[#1a1b1e] text-[#8e9299] border border-[#2a2b2e]")}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setShowAddUser(true)}
            className={cn(btnClass, "w-full bg-[#1a1b1e] text-emerald-400 border border-emerald-500/30 hover:border-emerald-500/70")}
          >
            + Add User
          </button>
        )}
      </Section>

      {/* ── Active Sessions ─────────────────────────────────────────── */}
      <Section title="Active Sessions">
        {sessions.length === 0 ? (
          <p className="text-xs text-[#666]">No active sessions</p>
        ) : (
          <div className="space-y-1">
            {sessions.map((s) => (
              <div
                key={s.socketId}
                className="flex items-center justify-between bg-[#0a0a0a] border border-[#2a2b2e] rounded px-3 py-2 gap-2"
              >
                <div className="min-w-0">
                  <span className="text-xs font-mono font-bold text-white">
                    {s.callsign}
                  </span>
                  <span className="text-[0.6rem] text-[#666] ml-2">
                    {s.ip} · {formatDuration(Date.now() - s.connectedAt)} ago
                  </span>
                </div>
                <button
                  onClick={() => handleForceLogout(s.socketId)}
                  disabled={s.callsign === callsign || opPending}
                  className={cn(btnClass, "bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/30 disabled:opacity-30 disabled:cursor-not-allowed")}
                >
                  Kick
                </button>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* ── Lockouts ────────────────────────────────────────────────── */}
      <Section title="Lockouts">
        {lockouts.length === 0 ? (
          <p className="text-xs text-[#666]">No active lockouts</p>
        ) : (
          <div className="space-y-1">
            {lockouts.map((l) => (
              <div
                key={`${l.callsign}-${l.type}`}
                className="flex items-center justify-between bg-[#0a0a0a] border border-[#2a2b2e] rounded px-3 py-2 gap-2"
              >
                <div className="min-w-0">
                  <span className="text-xs font-mono font-bold text-white">{l.callsign}</span>
                  <span className="text-[0.6rem] text-[#666] ml-2">{l.type}</span>
                  <span className="text-[0.6rem] text-[#666] ml-2">
                    until {new Date(l.resetAt).toLocaleTimeString()}
                  </span>
                </div>
                <button
                  onClick={() => handleUnlockCallsign(l.callsign)}
                  disabled={opPending}
                  className={cn(btnClass, "bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 border border-emerald-500/30 disabled:opacity-30 disabled:cursor-not-allowed")}
                >
                  Unlock
                </button>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* ── Audit Log ───────────────────────────────────────────────── */}
      <Section title="Audit Log">
        <div className="max-h-40 overflow-y-auto space-y-0.5 bg-[#0a0a0a] border border-[#2a2b2e] rounded p-2">
          {auditLog.length === 0 ? (
            <p className="text-xs text-[#666]">No entries</p>
          ) : (
            auditLog.map((e, i) => (
              <div key={i} className="flex gap-2 text-[0.6rem] font-mono text-[#8e9299]">
                <span className="text-[#444] flex-shrink-0">
                  {formatAuditTimestamp(e.ts)}
                </span>
                <span className="text-emerald-600 flex-shrink-0">{e.event}</span>
                <span className="text-white">{e.callsign}</span>
                {e.detail && <span className="text-[#666]">{e.detail}</span>}
              </div>
            ))
          )}
        </div>
      </Section>

      {/* ── System Info ─────────────────────────────────────────────── */}
      <Section title="System Info">
        {systemInfo ? (
          <div className="bg-[#0a0a0a] border border-[#2a2b2e] rounded p-3 space-y-1">
            {[
              ["Version", systemInfo.version],
              ["Uptime", formatUptime(systemInfo.uptime)],
              ["Node.js", systemInfo.nodeVersion],
              ["TLS Cert Expiry", systemInfo.certExpiry],
            ].map(([label, value]) => (
              <div key={label} className="flex justify-between gap-3 text-xs">
                <span className="text-[#8e9299] flex-shrink-0">{label}</span>
                <span className="font-mono text-white text-right">{value}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-[#666]">Loading…</p>
        )}
      </Section>

      {/* ── Danger Zone ─────────────────────────────────────────────── */}
      <Section title="Danger Zone">
        <div className="bg-red-950/20 border border-red-500/20 rounded-lg p-4 space-y-4">
          {/* Clear user preferences */}
          <div className="space-y-2">
            <p className="text-xs font-bold text-[#8e9299]">Clear User Preferences</p>
            <div className="flex gap-2">
              <select
                value={clearPrefsTarget}
                onChange={(e) => setClearPrefsTarget(e.target.value)}
                className="flex-1 bg-[#0a0a0a] border border-[#2a2b2e] rounded px-2 py-1.5 text-xs font-mono text-white focus:outline-none focus:border-red-500/50 transition-colors"
              >
                <option value="">Select user…</option>
                {users.map((u) => (
                  <option key={u.callsign} value={u.callsign}>
                    {u.callsign}
                  </option>
                ))}
              </select>
              <button
                onClick={handleClearPrefs}
                disabled={!clearPrefsTarget || opPending}
                className={cn(btnClass, "bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/30 disabled:opacity-30 disabled:cursor-not-allowed")}
              >
                Clear
              </button>
            </div>
          </div>

          {/* Factory reset */}
          <div className="space-y-2 border-t border-red-500/20 pt-4">
            <p className="text-xs font-bold text-red-400">Factory Reset</p>
            <p className="text-[0.625rem] text-[#8e9299]">
              Removes all users and resets the default ADMIN/admin credentials. All active sessions are disconnected.
            </p>
            {!showResetConfirm ? (
              <button
                onClick={() => setShowResetConfirm(true)}
                className={cn(btnClass, "bg-red-500/10 text-red-400 hover:bg-red-500/30 border border-red-500/40")}
              >
                Factory Reset…
              </button>
            ) : (
              <div className="space-y-2">
                <input
                  type="text"
                  placeholder='Type "RESET" to confirm'
                  value={resetConfirmText}
                  onChange={(e) => setResetConfirmText(e.target.value)}
                  className="w-full bg-[#0a0a0a] border border-red-500/40 rounded px-2 py-1.5 text-xs font-mono text-white focus:outline-none focus:border-red-500 transition-colors"
                />
                <div className="flex gap-2">
                  <button
                    onClick={handleFactoryReset}
                    disabled={resetConfirmText !== "RESET" || opPending}
                    className={cn(btnClass, "flex-1 bg-red-600 hover:bg-red-500 text-white border border-red-500 disabled:opacity-40 disabled:cursor-not-allowed")}
                  >
                    Confirm Reset
                  </button>
                  <button
                    onClick={() => { setShowResetConfirm(false); setResetConfirmText(""); }}
                    className={cn(btnClass, "flex-1 bg-[#1a1b1e] text-[#8e9299] border border-[#2a2b2e]")}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </Section>
    </div>
  );
}

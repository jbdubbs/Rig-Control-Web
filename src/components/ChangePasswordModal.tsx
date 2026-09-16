import React, { useEffect, useState } from "react";
import { KeyRound } from "lucide-react";
import { cn } from "../utils";
import type { Socket } from "socket.io-client";

interface Props {
  socket: Socket | null;
  callsign: string;
  forced: boolean; // true = mustChangePassword, false = voluntary
  onSuccess: () => void;
  onCancel?: () => void;
}

export default function ChangePasswordModal({
  socket,
  callsign,
  forced,
  onSuccess,
  onCancel,
}: Props) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Registered once for the component's lifetime (not per-submit via socket.once) and torn
  // down on unmount, so a response that arrives after the modal has already unmounted never
  // calls setState on it, and a second submit never stacks a duplicate listener on the same
  // generic event name. Mirrors AdminTab.tsx's admin:op-result handling.
  useEffect(() => {
    if (!socket) return;
    const onOpResult = (data: { ok: boolean; error?: string }) => {
      setSubmitting(false);
      if (data.ok) {
        onSuccess();
      } else {
        setError(data.error ?? "Failed to change password");
      }
    };
    socket.on("auth:op-result", onOpResult);
    return () => {
      socket.off("auth:op-result", onOpResult);
    };
  }, [socket, onSuccess]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (newPassword.length < 8) {
      setError("New password must be at least 8 characters");
      return;
    }
    if (newPassword.length > 72) {
      setError("New password must be 72 characters or fewer");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }
    if (!currentPassword) {
      setError("Current password is required");
      return;
    }
    if (newPassword === currentPassword) {
      setError("New password must be different from your current password");
      return;
    }

    setSubmitting(true);
    socket?.emit("auth:change-password", { currentPassword, newPassword });
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="bg-[#111] border border-[#2a2b2e] rounded-xl p-6 space-y-5">
          <div className="flex items-center gap-2">
            <KeyRound size={18} className="text-emerald-500" />
            <div>
              <h2 className="text-sm font-bold uppercase tracking-widest text-white">
                {forced ? "Change Password Required" : "Change Password"}
              </h2>
              <p className="text-xs text-[#8e9299] mt-0.5">
                {forced
                  ? `Welcome, ${callsign}. You must set a new password before continuing.`
                  : `Changing password for ${callsign}`}
              </p>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1">
              <label className="text-xs font-bold uppercase tracking-wider text-[#8e9299]">
                Current Password
              </label>
              <input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                autoComplete="current-password"
                className="w-full bg-[#0a0a0a] border border-[#2a2b2e] rounded-lg px-3 py-2 text-sm font-mono text-white focus:outline-none focus:border-emerald-600 transition-colors"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-bold uppercase tracking-wider text-[#8e9299]">
                New Password
              </label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
                className="w-full bg-[#0a0a0a] border border-[#2a2b2e] rounded-lg px-3 py-2 text-sm font-mono text-white focus:outline-none focus:border-emerald-600 transition-colors"
              />
              <p className="text-xs text-[#666]">8–72 characters</p>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-bold uppercase tracking-wider text-[#8e9299]">
                Confirm New Password
              </label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                className="w-full bg-[#0a0a0a] border border-[#2a2b2e] rounded-lg px-3 py-2 text-sm font-mono text-white focus:outline-none focus:border-emerald-600 transition-colors"
              />
            </div>

            {error && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2 text-xs text-red-400 font-mono">
                {error}
              </div>
            )}

            <div className="flex gap-3">
              {!forced && onCancel && (
                <button
                  type="button"
                  onClick={onCancel}
                  className="flex-1 py-2.5 rounded-lg font-bold uppercase text-sm tracking-wider bg-[#1a1b1e] text-[#8e9299] border border-[#2a2b2e] hover:border-[#444] transition-all"
                >
                  Cancel
                </button>
              )}
              <button
                type="submit"
                disabled={submitting}
                className={cn(
                  "flex-1 py-2.5 rounded-lg font-bold uppercase text-sm tracking-wider transition-all",
                  submitting
                    ? "bg-[#1a1b1e] text-[#444] border border-[#2a2b2e] cursor-not-allowed"
                    : "bg-emerald-600 hover:bg-emerald-500 text-white border border-emerald-500"
                )}
              >
                {submitting ? "Saving…" : "Save Password"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

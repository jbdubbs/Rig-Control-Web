import { useState, useEffect, useCallback } from "react";
import type { Socket } from "socket.io-client";
import { MUFMAP_STORAGE_KEY } from "../types/layout";

export type AuthState =
  | "unknown"
  | "authenticated"
  | "unauthenticated"
  | "must-change-password";

export interface AuthUser {
  callsign: string;
  role: "admin" | "regular";
}

interface UseAuthReturn {
  authState: AuthState;
  currentUser: AuthUser | null;
  mustChangePassword: boolean;
  loginError: string;
  retryAfter: number;
  login: (callsign: string, password: string) => void;
  logout: () => void;
  onPasswordChanged: () => void;
}

export function useAuth(socket: Socket | null): UseAuthReturn {
  const [authState, setAuthState] = useState<AuthState>("unknown");
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [mustChangePassword, setMustChangePassword] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [retryAfter, setRetryAfter] = useState(0);

  useEffect(() => {
    if (!socket) return;

    const onAuthRequired = () => {
      setAuthState("unauthenticated");
      setCurrentUser(null);
    };

    const onTokenRefreshed = ({
      token,
      callsign,
      role,
      mustChangePassword,
    }: {
      token: string;
      callsign?: string;
      role?: "admin" | "regular";
      mustChangePassword?: boolean;
    }) => {
      localStorage.setItem("auth-token", token);
      if (callsign && role) {
        setCurrentUser({ callsign, role });
      }
      if (mustChangePassword) {
        setMustChangePassword(true);
        setAuthState("must-change-password");
      } else {
        setAuthState("authenticated");
      }
    };

    const onAuthResult = (data: {
      ok: boolean;
      token?: string;
      callsign?: string;
      role?: "admin" | "regular";
      mustChangePassword?: boolean;
      preferencesClearedAt?: string | null;
      error?: string;
      retryAfter?: number;
    }) => {
      if (data.ok && data.token && data.callsign && data.role) {
        localStorage.setItem("auth-token", data.token);
        if (data.preferencesClearedAt) {
          checkAndClearPreferences(data.callsign, data.preferencesClearedAt);
        }
        setCurrentUser({ callsign: data.callsign, role: data.role });
        setLoginError("");
        setRetryAfter(0);
        if (data.mustChangePassword) {
          setMustChangePassword(true);
          setAuthState("must-change-password");
        } else {
          setMustChangePassword(false);
          setAuthState("authenticated");
        }
      } else {
        setLoginError(data.error ?? "Login failed");
        setRetryAfter(data.retryAfter ?? 0);
      }
    };

    const onKicked = ({ reason }: { reason: string }) => {
      console.log(`[AUTH] Kicked: ${reason}`);
      localStorage.removeItem("auth-token");
      setAuthState("unauthenticated");
      setCurrentUser(null);
      setMustChangePassword(false);
    };

    const onPreferencesCleared = () => {
      if (currentUser) {
        clearUserPreferences(currentUser.callsign);
        window.location.reload();
      }
    };

    socket.on("auth:required", onAuthRequired);
    socket.on("auth:token-refreshed", onTokenRefreshed);
    socket.on("auth:result", onAuthResult);
    socket.on("auth:kicked", onKicked);
    socket.on("auth:preferences-cleared", onPreferencesCleared);

    return () => {
      socket.off("auth:required", onAuthRequired);
      socket.off("auth:token-refreshed", onTokenRefreshed);
      socket.off("auth:result", onAuthResult);
      socket.off("auth:kicked", onKicked);
      socket.off("auth:preferences-cleared", onPreferencesCleared);
    };
  }, [socket, currentUser]);

  // On socket reconnect, reset to unknown so the UI waits for auth:token-refreshed or auth:required
  useEffect(() => {
    if (!socket) return;
    let firstConnect = true;

    const onConnect = () => {
      if (firstConnect) { firstConnect = false; return; }
      setAuthState("unknown");
      setCurrentUser(null);
    };

    socket.on("connect", onConnect);
    return () => { socket.off("connect", onConnect); };
  }, [socket]);

  const login = useCallback(
    (callsign: string, password: string) => {
      if (!socket) return;
      setLoginError("");
      socket.emit("auth:login", { callsign, password });
    },
    [socket]
  );

  const logout = useCallback(() => {
    if (!socket) return;
    socket.emit("auth:logout");
    localStorage.removeItem("auth-token");
    setAuthState("unauthenticated");
    setCurrentUser(null);
    setMustChangePassword(false);
  }, [socket]);

  const onPasswordChanged = useCallback(() => {
    setMustChangePassword(false);
    setAuthState("authenticated");
  }, []);

  return {
    authState,
    currentUser,
    mustChangePassword,
    loginError,
    retryAfter,
    login,
    logout,
    onPasswordChanged,
  };
}

// ─── localStorage preference helpers ─────────────────────────────────────────

export const NAMESPACED_KEYS = [
  "grid-layout-v1",
  "spots-combo-tab",
  MUFMAP_STORAGE_KEY,

  // Panel collapse state (usePanelState.ts / usePotaSpots.tsx), current keys
  "compact-vfo-collapsed",
  "phone-vfo-collapsed",
  "compact-video-feed-collapsed",
  "phone-video-feed-collapsed",
  "compact-audio-feed-collapsed",
  "phone-audio-feed-collapsed",
  "compact-console-collapsed",
  "phone-console-collapsed",
  "compact-combospots-collapsed",
  "phone-combospots-collapsed",
  "compact-solar-collapsed",
  "phone-solar-collapsed",
  "compact-mufmap-collapsed",
  "phone-mufmap-collapsed",
  "compact-cwdecode-collapsed",
  "phone-cwdecode-collapsed",
  "compact-spectrum-hamlib-collapsed",
  "phone-spectrum-hamlib-collapsed",
  "compact-spectrum-audio-collapsed",
  "phone-spectrum-audio-collapsed",
  "compact-smeter-collapsed",
  "compact-controls-collapsed",
  "compact-rfpower-collapsed",
  "phone-meter-collapsed",
  "phone-quickcontrols-collapsed",
  "compact-pota-spots-collapsed",
  "phone-pota-spots-collapsed",
  "compact-sota-spots-collapsed",
  "phone-sota-spots-collapsed",
  "compact-wwff-spots-collapsed",
  "phone-wwff-spots-collapsed",

  // Panel collapse state, pre-compact/phone-split legacy key names — only
  // ever read as a fallback (never written by current code), kept here so a
  // preferences reset also clears any leftover data from older sessions.
  "vfo-collapsed",
  "video-feed-collapsed",
  "audio-feed-collapsed",
  "console-collapsed",
  "combospots-collapsed",
  "solar-collapsed",
  "mufmap-collapsed",
  "cwdecode-collapsed",
  "spectrum-hamlib-collapsed",
  "spectrum-audio-collapsed",
  "is-compact-smeter-collapsed",
  "is-compact-controls-collapsed",
  "is-compact-rfpower-collapsed",
  "pota-spots-collapsed",
  "sota-spots-collapsed",
  "wwff-spots-collapsed",

  // Spectrum scope display settings (SpectrumHamlibPanel.tsx / SpectrumAudioPanel.tsx)
  "spectrum-hamlib-colormap",
  "spectrum-hamlib-floor",
  "spectrum-hamlib-ceiling",
  "spectrum-hamlib-floor-ft4222",
  "spectrum-hamlib-ceiling-ft4222",
  "spectrum-hamlib-floor-iq",
  "spectrum-hamlib-ceiling-iq",
  "spectrum-hamlib-autoFloor",
  "spectrum-hamlib-autoCeiling",
  "spectrum-hamlib-autoFloor-ft4222",
  "spectrum-hamlib-autoCeiling-ft4222",
  "spectrum-hamlib-autoFloor-iq",
  "spectrum-hamlib-autoCeiling-iq",
  "spectrum-audio-colormap",
  "spectrum-audio-floor",
  "spectrum-audio-ceiling",
  "spectrum-audio-autoFloor",
  "spectrum-audio-autoCeiling",
  "spectrum-audio-bwOverride",
];

const PREFS_CLEARED_KEY = "prefs-cleared-at";

export function clearUserPreferences(callsign: string): void {
  const prefix = callsign.toUpperCase();
  NAMESPACED_KEYS.forEach((key) => {
    localStorage.removeItem(`${prefix}:${key}`);
  });
  localStorage.removeItem(`${prefix}:${PREFS_CLEARED_KEY}`);
}

export function checkAndClearPreferences(
  callsign: string,
  preferencesClearedAt: string
): void {
  const prefix = callsign.toUpperCase();
  const lastCleared = localStorage.getItem(`${prefix}:${PREFS_CLEARED_KEY}`);
  if (!lastCleared || new Date(preferencesClearedAt) > new Date(lastCleared)) {
    clearUserPreferences(callsign);
    localStorage.setItem(`${prefix}:${PREFS_CLEARED_KEY}`, new Date().toISOString());
  }
}

export function nsKey(callsign: string, key: string): string {
  return `${callsign.toUpperCase()}:${key}`;
}

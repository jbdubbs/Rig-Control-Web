import { useState, useEffect, useRef, useCallback } from "react";
import { Socket } from "socket.io-client";
import type { DebugFlags } from "../types";

const DEFAULT_FLAGS: DebugFlags = {
  rig: false,
  audio: false,
  video: false,
  cw: false,
  infra: false,
  spectrum: false,
  spots: false,
  dxcluster: false,
  wsjtx: false,
  ft8: false,
};

// Mirrors server/diagnostics.ts's rolling window: the server only ever
// sends lines within its own last-10-minutes buffer, but it never tells an
// already-connected client to drop entries as they age out, so the client
// prunes independently by receipt time. MAX_LOGS is the same burst safety
// net as the server's MAX_LINES.
const MAX_AGE_MS = 10 * 60 * 1000;
const MAX_LOGS = 5000;
const PRUNE_INTERVAL_MS = 30000;

export function useDiagnostics(socket: Socket | null) {
  const [logs, setLogs] = useState<string[]>([]);
  const [flags, setFlags] = useState<DebugFlags>(DEFAULT_FLAGS);
  const logEndRef = useRef<HTMLDivElement>(null);
  // Parallel array of receipt timestamps, index-aligned with `logs`.
  const logTimestampsRef = useRef<number[]>([]);

  const pruneOld = useCallback(() => {
    const cutoff = Date.now() - MAX_AGE_MS;
    let dropCount = 0;
    while (dropCount < logTimestampsRef.current.length && logTimestampsRef.current[dropCount] < cutoff) {
      dropCount++;
    }
    if (dropCount > 0) {
      logTimestampsRef.current = logTimestampsRef.current.slice(dropCount);
      setLogs(prev => prev.slice(dropCount));
    }
  }, []);

  useEffect(() => {
    if (!socket) return;

    const onLog = (lines: string[]) => {
      const now = Date.now();
      logTimestampsRef.current = [...logTimestampsRef.current, ...lines.map(() => now)].slice(-MAX_LOGS);
      setLogs(prev => [...prev, ...lines].slice(-MAX_LOGS));
    };

    const onSnapshot = (lines: string[]) => {
      const now = Date.now();
      logTimestampsRef.current = lines.map(() => now).slice(-MAX_LOGS);
      setLogs(lines.slice(-MAX_LOGS));
    };

    const onDebugFlags = (data: DebugFlags) => {
      setFlags(data);
    };

    socket.on("diagnostics-log", onLog);
    socket.on("diagnostics-log-snapshot", onSnapshot);
    socket.on("debug-flags", onDebugFlags);

    const pruneInterval = setInterval(pruneOld, PRUNE_INTERVAL_MS);

    return () => {
      socket.off("diagnostics-log", onLog);
      socket.off("diagnostics-log-snapshot", onSnapshot);
      socket.off("debug-flags", onDebugFlags);
      clearInterval(pruneInterval);
    };
  }, [socket, pruneOld]);

  useEffect(() => {
    if (logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs]);

  const requestSnapshot = useCallback(() => {
    socket?.emit("get-diagnostics-log");
  }, [socket]);

  const toggleFlag = useCallback((key: keyof DebugFlags) => {
    socket?.emit("set-debug-flag", { key, value: !flags[key] });
  }, [socket, flags]);

  const enableAll = useCallback(() => {
    (Object.keys(flags) as (keyof DebugFlags)[]).forEach(key => {
      if (!flags[key]) socket?.emit("set-debug-flag", { key, value: true });
    });
  }, [socket, flags]);

  const clearView = useCallback(() => {
    logTimestampsRef.current = [];
    setLogs([]);
  }, []);

  return { logs, flags, logEndRef, requestSnapshot, toggleFlag, enableAll, clearView };
}

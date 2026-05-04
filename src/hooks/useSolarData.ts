import { useState, useEffect, useCallback } from "react";
import type { Socket } from "socket.io-client";
import type { SolarData } from "../types/solar";

const ONE_HOUR = 3_600_000;

export function useSolarData(socket: Socket | null, enabled: boolean) {
  const [solarData, setSolarData] = useState<SolarData | null>(null);

  useEffect(() => {
    if (!socket) return;
    const handler = (data: SolarData) => setSolarData(data);
    socket.on("solar-data", handler);
    return () => { socket.off("solar-data", handler); };
  }, [socket]);

  // Fetch once when enabled, or when data has gone stale
  useEffect(() => {
    if (!socket || !enabled) return;
    const age = solarData ? Date.now() - solarData.fetchedAt : Infinity;
    if (age > ONE_HOUR) {
      socket.emit("request-solar-data");
    }
  }, [socket, enabled, solarData]);

  const requestSolarData = useCallback(() => {
    socket?.emit("request-solar-data");
  }, [socket]);

  return { solarData, requestSolarData };
}

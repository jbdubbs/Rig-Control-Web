import { useState, useEffect, useRef } from "react";
import { Socket } from "socket.io-client";

interface UseRigctldOptions {
  socket: Socket | null;
}

export function useRigctld({ socket }: UseRigctldOptions) {
  // ── Settings & process state ───────────────────────────────────────────────
  const [rigctldSettings, setRigctldSettings] = useState({
    rigNumber: "",
    serialPort: "",
    portNumber: "4532",
    ipAddress: "127.0.0.1",
    serialPortSpeed: "38400",
    preampCapabilities: [] as string[],
    attenuatorCapabilities: [] as string[],
    agcCapabilities: [] as string[],
    nbSupported: false,
    nbLevelRange: { min: 0, max: 1, step: 0.1 },
    nrSupported: false,
    nrLevelRange: { min: 0, max: 1, step: 0.1 },
    rfPowerRange: { min: 0, max: 1, step: 0.01 },
    anfSupported: false,
  });
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [statusLoaded, setStatusLoaded] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [activeSettingsTab, setActiveSettingsTab] = useState<'rigctld' | 'spots' | 'cw'>('rigctld');
  const [radios, setRadios] = useState<{ id: string; mfg: string; model: string }[]>([]);
  const [rigctldProcessStatus, setRigctldProcessStatus] = useState<"running" | "stopped" | "error" | "already_running">("stopped");
  const [preampLevels, setPreampLevels] = useState<string[]>([]);
  const [attenuatorLevels, setAttenuatorLevels] = useState<string[]>([]);
  const [agcLevels, setAgcLevels] = useState<string[]>([]);
  const [rigctldLogs, setRigctldLogs] = useState<string[]>([]);
  const [rigctldVersionInfo, setRigctldVersionInfo] = useState<{ version: string | null; isSupported: boolean }>({ version: null, isSupported: true });
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  // ── Capability state (set by rigctld socket events, used by level sliders) ─
  const [nbCapabilities, setNbCapabilities] = useState({ supported: false, range: { min: 0, max: 1, step: 0.1 } });
  const [nrCapabilities, setNrCapabilities] = useState({ supported: false, range: { min: 0, max: 1, step: 0.066667 } });
  const [anfCapabilities, setAnfCapabilities] = useState({ supported: false });
  const [rfPowerCapabilities, setRfPowerCapabilities] = useState({ range: { min: 0, max: 1, step: 0.01 } });

  const logEndRef = useRef<HTMLDivElement>(null);

  // ── Socket event registration ─────────────────────────────────────────────
  useEffect(() => {
    if (!socket) return;

    const onSettingsData = (data: any) => {
      if (data.settings) {
        setRigctldSettings(data.settings);
        if (data.settings.preampCapabilities) setPreampLevels(data.settings.preampCapabilities);
        if (data.settings.attenuatorCapabilities) setAttenuatorLevels(data.settings.attenuatorCapabilities);
        if (data.settings.agcCapabilities) setAgcLevels(data.settings.agcCapabilities);
        if (data.settings.rfPowerRange) setRfPowerCapabilities({ range: data.settings.rfPowerRange });
      }
      setSettingsLoaded(true);
    };

    const onRadiosList = (list: any) => {
      const unique = Array.from(new Map(list.map((r: any) => [r.id, r])).values()) as any[];
      setRadios(unique);
    };

    const onRigctldStatus = (data: any) => {
      if (typeof data === 'string') {
        setRigctldProcessStatus(data as any);
      } else {
        setRigctldProcessStatus(data.status);
        if (data.logs) setRigctldLogs(data.logs);
        setRigctldVersionInfo({ version: data.version, isSupported: data.isVersionSupported });
      }
      setStatusLoaded(true);
    };

    const onRigctldLog = (lines: string[]) => {
      setRigctldLogs(prev => [...prev, ...lines].slice(-100));
    };

    const onTestResult = (result: { success: boolean; message: string }) => {
      setTestResult(result);
      setTimeout(() => setTestResult(null), 5000);
    };

    const onPreampCapabilities = (levels: string[]) => {
      setPreampLevels(levels);
      setRigctldSettings(prev => ({ ...prev, preampCapabilities: levels }));
    };

    const onAttenuatorCapabilities = (levels: string[]) => {
      setAttenuatorLevels(levels);
      setRigctldSettings(prev => ({ ...prev, attenuatorCapabilities: levels }));
    };

    const onAgcCapabilities = (levels: string[]) => {
      setAgcLevels(levels);
      setRigctldSettings(prev => ({ ...prev, agcCapabilities: levels }));
    };

    const onNbCapabilities = (data: { supported: boolean; range: { min: number; max: number; step: number } }) => {
      setNbCapabilities(data);
      setRigctldSettings(prev => ({ ...prev, nbSupported: data.supported, nbLevelRange: data.range }));
    };

    const onNrCapabilities = (data: { supported: boolean; range: { min: number; max: number; step: number } }) => {
      setNrCapabilities(data);
      setRigctldSettings(prev => ({ ...prev, nrSupported: data.supported, nrLevelRange: data.range }));
    };

    const onAnfCapabilities = (data: { supported: boolean }) => {
      setAnfCapabilities(data);
      setRigctldSettings(prev => ({ ...prev, anfSupported: data.supported }));
    };

    const onRfpowerCapabilities = (data: { range: { min: number; max: number; step: number } }) => {
      setRfPowerCapabilities(data);
      setRigctldSettings(prev => ({ ...prev, rfPowerRange: data.range }));
    };

    socket.on("settings-data", onSettingsData);
    socket.on("radios-list", onRadiosList);
    socket.on("rigctld-status", onRigctldStatus);
    socket.on("rigctld-log", onRigctldLog);
    socket.on("test-result", onTestResult);
    socket.on("preamp-capabilities", onPreampCapabilities);
    socket.on("attenuator-capabilities", onAttenuatorCapabilities);
    socket.on("agc-capabilities", onAgcCapabilities);
    socket.on("nb-capabilities", onNbCapabilities);
    socket.on("nr-capabilities", onNrCapabilities);
    socket.on("anf-capabilities", onAnfCapabilities);
    socket.on("rfpower-capabilities", onRfpowerCapabilities);

    return () => {
      socket.off("settings-data", onSettingsData);
      socket.off("radios-list", onRadiosList);
      socket.off("rigctld-status", onRigctldStatus);
      socket.off("rigctld-log", onRigctldLog);
      socket.off("test-result", onTestResult);
      socket.off("preamp-capabilities", onPreampCapabilities);
      socket.off("attenuator-capabilities", onAttenuatorCapabilities);
      socket.off("agc-capabilities", onAgcCapabilities);
      socket.off("nb-capabilities", onNbCapabilities);
      socket.off("nr-capabilities", onNrCapabilities);
      socket.off("anf-capabilities", onAnfCapabilities);
      socket.off("rfpower-capabilities", onRfpowerCapabilities);
    };
  }, [socket]);

  // ── Log auto-scroll ───────────────────────────────────────────────────────
  useEffect(() => {
    if (logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [rigctldLogs]);

  // ── Helpers ───────────────────────────────────────────────────────────────
  const isSettingsValid = () =>
    !!(rigctldSettings.rigNumber &&
      rigctldSettings.serialPort &&
      rigctldSettings.portNumber &&
      rigctldSettings.ipAddress &&
      rigctldSettings.serialPortSpeed);

  return {
    // Settings & process state
    rigctldSettings, setRigctldSettings,
    settingsLoaded, setSettingsLoaded,
    statusLoaded,
    isSettingsOpen, setIsSettingsOpen,
    activeSettingsTab, setActiveSettingsTab,
    radios,
    rigctldProcessStatus,
    preampLevels,
    attenuatorLevels,
    agcLevels,
    rigctldLogs, setRigctldLogs,
    rigctldVersionInfo,
    testResult,
    // Capability state
    nbCapabilities,
    nrCapabilities,
    anfCapabilities,
    rfPowerCapabilities,
    // Refs
    logEndRef,
    // Helpers
    isSettingsValid,
  };
}

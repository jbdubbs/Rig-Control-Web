import { useState, useEffect, useRef, useCallback, type FormEvent } from "react";
import { Socket } from "socket.io-client";
import { VOICE_MODES, MODES_FALLBACK, DEFAULT_STATUS } from "../constants";
import type { RigStatus, SwrProtectionSettings, SwrTrip } from "../types";

let rigVerbose = false;
const vlog = (...args: any[]) => { if (rigVerbose) console.log(...args); };

/** Mirrors server/rigComm.ts's tested formatExtendedCommand(): rigctld's
 *  extended-response protocol prefixes single-letter short-form commands
 *  with a bare "+" (e.g. "+f"), and multi-letter long-form command names
 *  with "+\" (e.g. "+\get_powerstat"). A stray "+\f" is parsed by rigctld
 *  as a request for a long-form command literally named "f", which
 *  doesn't exist — rigctld logs the failure server-side but never writes
 *  a response to the client socket, hanging the caller until the rig
 *  command timeout fires and tears down the connection. Commands the user
 *  has already prefixed with "+" themselves are passed through unchanged. */
export function formatRawCommand(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith("+")) return trimmed;
  const firstToken = trimmed.split(/\s+/)[0];
  return firstToken.length === 1 ? `+${trimmed}` : `+\\${trimmed}`;
}

interface UseRigControlOptions {
  socket: Socket | null;
  nrCapabilities: { supported: boolean; range: { min: number; max: number; step: number } };
  preampLevels: string[];
  attenuatorLevels: string[];
  agcLevels: string[];
  localAudioReady: boolean;
  outboundMuted: boolean;
  setOutboundMuted: (v: boolean) => void;
}

export function useRigControl({
  socket,
  nrCapabilities,
  preampLevels,
  attenuatorLevels,
  agcLevels,
  localAudioReady,
  outboundMuted,
  setOutboundMuted,
}: UseRigControlOptions) {
  // ── State ─────────────────────────────────────────────────────────────────
  const [connected, setConnected] = useState(false);
  const [vfoSupported, setVfoSupported] = useState(true);
  const [powerSupported, setPowerSupported] = useState(false);
  const [host, setHost] = useState(() => localStorage.getItem("last-host") || "127.0.0.1");
  const [port, setPort] = useState(() => parseInt(localStorage.getItem("last-port") || "4532"));
  const [status, setStatus] = useState<RigStatus>(() => {
    try {
      const saved = localStorage.getItem("last-rig-status");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === 'object') return parsed;
      }
    } catch (e) {}
    return DEFAULT_STATUS;
  });
  const [history, setHistory] = useState<any[]>([]);
  const [pollRate, setPollRate] = useState(() => parseInt(localStorage.getItem("last-poll-rate") || "2000"));
  const [vfoA, setVfoA] = useState(() => localStorage.getItem("last-vfoA") || "14074000");
  const [vfoB, setVfoB] = useState(() => localStorage.getItem("last-vfoB") || "7074000");
  const [error, setError] = useState<string | null>(null);
  const [rigConnecting, setRigConnecting] = useState<{ attempt: number; maxAttempts: number; auto?: boolean; knownPoweredOff?: boolean } | null>(null);
  const [opError, setOpError] = useState<string | null>(null);
  const [swrProtection, setSwrProtection] = useState<SwrProtectionSettings>({ enabled: false, threshold: 3 });
  const [swrTrip, setSwrTrip] = useState<SwrTrip | null>(null);
  const opErrorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [rawCommand, setRawCommand] = useState("");
  const [consoleLogs, setConsoleLogs] = useState<{ cmd: string; resp: string; time: string }[]>([]);
  const [availableModes, setAvailableModes] = useState<string[]>(MODES_FALLBACK);
  const [vfoStep, setVfoStep] = useState(0.001);
  const [inputVfoA, setInputVfoA] = useState("");
  const [inputVfoB, setInputVfoB] = useState("");
  const [localMode, setLocalMode] = useState(() => localStorage.getItem("last-mode") || "USB");
  const [localRFPower, setLocalRFPower] = useState(() => parseFloat(localStorage.getItem("last-rfpower") || "0.5"));
  const [localRFLevel, setLocalRFLevel] = useState(0);
  const [localNRLevel, setLocalNRLevel] = useState(0);
  const [localNBLevel, setLocalNBLevel] = useState(0);
  const [pendingVfoOp, setPendingVfoOp] = useState<string | null>(null);
  const [isTuning, setIsTuning] = useState(false);
  const [tuneJustFinished, setTuneJustFinished] = useState(false);

  // ── Refs ──────────────────────────────────────────────────────────────────
  const isDraggingRF = useRef(false);
  const isDraggingRFLevel = useRef(false);
  const isDraggingNR = useRef(false);
  const isDraggingNB = useRef(false);
  const isChangingMode = useRef(false);
  const targetModeRef = useRef("");
  const modeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tuningTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tuneSeenPTTRef = useRef(false);
  const tuneJustFinishedRef = useRef(false);
  const skipPollsCount = useRef(0);
  const pttRef = useRef(false);
  const connectedRef = useRef(false);
  const uiConnectedRef = useRef(false);
  const hasAttemptedAutoconnect = useRef(false);
  const isAutoconnectAttempt = useRef(false);
  const nrCapabilitiesRef = useRef(nrCapabilities);

  // Inline-during-render refs for stable useCallback deps (safe: only read in callbacks, never during render)
  const statusRef = useRef(status);
  const vfoARef = useRef(vfoA);
  const vfoBRef = useRef(vfoB);
  const vfoStepRef = useRef(vfoStep);
  const connectedStateRef = useRef(connected);
  const availableModesRef = useRef(availableModes);
  const rawCommandRef = useRef(rawCommand);
  const hostRef = useRef(host);
  const portRef = useRef(port);
  const outboundMutedRef = useRef(outboundMuted);
  const localAudioReadyRef = useRef(localAudioReady);
  const preampLevelsRef = useRef(preampLevels);
  const attenuatorLevelsRef = useRef(attenuatorLevels);
  const agcLevelsRef = useRef(agcLevels);
  const setOutboundMutedRef = useRef(setOutboundMuted);

  statusRef.current = status;
  vfoARef.current = vfoA;
  vfoBRef.current = vfoB;
  vfoStepRef.current = vfoStep;
  connectedStateRef.current = connected;
  availableModesRef.current = availableModes;
  rawCommandRef.current = rawCommand;
  hostRef.current = host;
  portRef.current = port;
  outboundMutedRef.current = outboundMuted;
  localAudioReadyRef.current = localAudioReady;
  preampLevelsRef.current = preampLevels;
  attenuatorLevelsRef.current = attenuatorLevels;
  agcLevelsRef.current = agcLevels;
  setOutboundMutedRef.current = setOutboundMuted;

  // ── Ref sync ──────────────────────────────────────────────────────────────
  useEffect(() => { connectedRef.current = connected; }, [connected]);
  useEffect(() => { pttRef.current = status?.ptt ?? false; }, [status]);
  useEffect(() => { nrCapabilitiesRef.current = nrCapabilities; }, [nrCapabilities]);

  // ── Persist to localStorage ────────────────────────────────────────────────
  useEffect(() => { if (status) localStorage.setItem("last-rig-status", JSON.stringify(status)); }, [status]);
  useEffect(() => { localStorage.setItem("last-vfoA", vfoA); }, [vfoA]);
  useEffect(() => { localStorage.setItem("last-vfoB", vfoB); }, [vfoB]);
  useEffect(() => { localStorage.setItem("last-mode", localMode); }, [localMode]);
  useEffect(() => { localStorage.setItem("last-rfpower", (localRFPower ?? 0.5).toString()); }, [localRFPower]);

  // ── Input sync from VFO state ──────────────────────────────────────────────
  useEffect(() => {
    if (document.activeElement?.id !== "vfoA-input") {
      setInputVfoA((parseFloat(vfoA) / 1000000).toFixed(6));
    }
  }, [vfoA]);

  useEffect(() => {
    if (document.activeElement?.id !== "vfoB-input") {
      setInputVfoB((parseFloat(vfoB) / 1000000).toFixed(6));
    }
  }, [vfoB]);

  // ── Helper ────────────────────────────────────────────────────────────────
  const findClosestDNRValue = (val: number) => {
    const caps = nrCapabilitiesRef.current;
    if (!caps.range.step) return val;
    const steps = Math.round((val - caps.range.min) / caps.range.step);
    return Math.min(caps.range.max, caps.range.min + steps * caps.range.step);
  };

  // ── Handlers (defined before drag effects that call handleSetLevel) ────────
  // All use inline refs so deps stay [socket] — stable after first connect.
  const handleSetLevel = useCallback((level: string, val: number) => {
    const key = level.toLowerCase() === "rfpower" ? "rfpower" :
                level.toLowerCase() === "rf" ? "rfLevel" :
                level.toLowerCase() === "agc" ? "agc" :
                level.toLowerCase() === "att" ? "attenuation" :
                level.toLowerCase() === "preamp" ? "preamp" :
                level.toLowerCase() === "nr" ? "nrLevel" :
                level.toLowerCase() === "nb" ? "nbLevel" : null;
    if (key) {
      skipPollsCount.current = 1;
      setStatus(prev => ({ ...(prev || DEFAULT_STATUS), [key]: val }));
    }
    socket?.emit("set-level", { level, val });
  }, [socket]);

  // ── Drag debounce effects ─────────────────────────────────────────────────
  useEffect(() => {
    if (!isDraggingRF.current) return;
    const timer = setTimeout(() => { handleSetLevel("RFPOWER", localRFPower); isDraggingRF.current = false; }, 1000);
    return () => clearTimeout(timer);
  }, [localRFPower, handleSetLevel]);

  useEffect(() => {
    if (!isDraggingRFLevel.current) return;
    const timer = setTimeout(() => { handleSetLevel("RF", localRFLevel); isDraggingRFLevel.current = false; }, 1000);
    return () => clearTimeout(timer);
  }, [localRFLevel, handleSetLevel]);

  useEffect(() => {
    if (!isDraggingNR.current) return;
    const timer = setTimeout(() => { handleSetLevel("NR", localNRLevel); isDraggingNR.current = false; }, 1000);
    return () => clearTimeout(timer);
  }, [localNRLevel, handleSetLevel]);

  useEffect(() => {
    if (!isDraggingNB.current) return;
    const timer = setTimeout(() => { handleSetLevel("NB", localNBLevel); isDraggingNB.current = false; }, 1000);
    return () => clearTimeout(timer);
  }, [localNBLevel, handleSetLevel]);

  // ── Rig control handlers ──────────────────────────────────────────────────
  const handleConnect = useCallback(() => {
    if (uiConnectedRef.current) {
      socket?.emit("set-autoconnect-eligible", false);
      socket?.emit("disconnect-rig");
    } else {
      socket?.emit("set-client-config", { host: hostRef.current, port: portRef.current });
      isAutoconnectAttempt.current = false;
      socket?.emit("connect-rig", { host: hostRef.current, port: portRef.current });
    }
  }, [socket]);

  const handleSetVFO = useCallback((vfo: string) => {
    skipPollsCount.current = 1;
    setStatus(prev => ({ ...(prev || DEFAULT_STATUS), vfo }));
    socket?.emit("set-vfo", vfo);
  }, [socket]);

  const handleSetFreq = useCallback((freq: string) => {
    skipPollsCount.current = 1;
    setStatus(prev => ({ ...prev, frequency: freq }));
    if (statusRef.current.vfo === "VFOA") setVfoA(freq);
    else setVfoB(freq);
    socket?.emit("set-frequency", freq);
  }, [socket, setVfoA, setVfoB]);

  const adjustVfoFrequency = useCallback((targetVfo: 'A' | 'B', direction: 1 | -1) => {
    if (!connectedStateRef.current) return;
    const currentFreq = targetVfo === 'A' ? parseInt(vfoARef.current) : parseInt(vfoBRef.current);
    const stepHz = Math.round(vfoStepRef.current * 1000000);
    const newFreq = currentFreq + direction * stepHz;
    const newFreqStr = newFreq.toString();
    if (targetVfo === 'A') {
      setVfoA(newFreqStr);
      setInputVfoA((newFreq / 1000000).toFixed(6));
    } else {
      setVfoB(newFreqStr);
      setInputVfoB((newFreq / 1000000).toFixed(6));
    }
    if (statusRef.current.vfo === (targetVfo === 'A' ? 'VFOA' : 'VFOB')) {
      handleSetFreq(newFreqStr);
    } else {
      handleSetVFO(targetVfo === 'A' ? 'VFOA' : 'VFOB');
      setTimeout(() => handleSetFreq(newFreqStr), 100);
    }
  }, [socket, setVfoA, setVfoB, setInputVfoA, setInputVfoB, handleSetFreq, handleSetVFO]);

  const handleSetMode = useCallback((mode: string) => {
    skipPollsCount.current = 1;
    setLocalMode(mode);
    setStatus(prev => ({ ...prev, mode }));
    targetModeRef.current = mode;
    isChangingMode.current = true;
    socket?.emit("set-mode", { mode, bandwidth: "-1" });
    if (modeTimeoutRef.current) clearTimeout(modeTimeoutRef.current);
    modeTimeoutRef.current = setTimeout(() => { isChangingMode.current = false; }, 5000);
  }, [socket]);

  const handleSetBw = useCallback((bw: number) => {
    const currentMode = statusRef.current?.mode || availableModesRef.current[0] || "USB";
    const bwStr = (bw ?? 2400).toString();
    skipPollsCount.current = 1;
    setStatus(prev => ({ ...(prev || DEFAULT_STATUS), bandwidth: bwStr }));
    socket?.emit("set-mode", { mode: currentMode, bandwidth: bwStr });
  }, [socket]);

  const handleSetPTT = useCallback((state: boolean) => {
    if (state && localAudioReadyRef.current && outboundMutedRef.current && VOICE_MODES.has(statusRef.current?.mode || "")) {
      setOutboundMutedRef.current(false);
      socket?.emit("mic-unmute-request");
    }
    skipPollsCount.current = 1;
    setStatus(prev => ({ ...(prev || DEFAULT_STATUS), ptt: state }));
    socket?.emit("set-ptt", state);
  }, [socket]);

  const handleToggleSplit = useCallback(() => {
    const st = statusRef.current;
    if (st.isSplit) {
      const targetVFO = st.txVFO === "VFOA" ? "VFOB" : "VFOA";
      skipPollsCount.current = 1;
      setStatus(prev => ({ ...prev, isSplit: false }));
      socket?.emit("set-split-vfo", { split: 0, txVFO: st.txVFO });
      handleSetVFO(targetVFO);
    } else {
      const txVFO = st.vfo === "VFOA" ? "VFOB" : "VFOA";
      skipPollsCount.current = 1;
      setStatus(prev => ({ ...prev, isSplit: true, txVFO }));
      socket?.emit("set-split-vfo", { split: 1, txVFO });
    }
  }, [socket, handleSetVFO]);

  const handlePollRateChange = useCallback((rate: number) => {
    setPollRate(rate);
    socket?.emit("set-poll-rate", rate);
  }, [socket]);

  const handleSetFunc = useCallback((func: string, state: boolean) => {
    const key = func.toLowerCase() as keyof RigStatus;
    skipPollsCount.current = 1;
    setStatus(prev => ({ ...(prev || DEFAULT_STATUS), [key]: state }));
    socket?.emit("set-func", { func, state });
  }, [socket]);

  const cyclePreamp = useCallback(() => {
    const levels = preampLevelsRef.current;
    if (levels.length === 0) { handleSetLevel("PREAMP", 0); return; }
    const opts = [0, ...levels.map(l => parseInt(l.replace('dB', '')))];
    let idx = opts.indexOf(statusRef.current.preamp);
    if (idx === -1) idx = 0;
    handleSetLevel("PREAMP", opts[(idx + 1) % opts.length]);
  }, [handleSetLevel]);

  const cycleAttenuator = useCallback(() => {
    const levels = attenuatorLevelsRef.current;
    if (levels.length === 0) return;
    const opts = [0, ...levels.map(l => parseInt(l.replace('dB', '')))];
    let idx = opts.indexOf(statusRef.current.attenuation);
    if (idx === -1) idx = 0;
    handleSetLevel("ATT", opts[(idx + 1) % opts.length]);
  }, [handleSetLevel]);

  const cycleAgc = useCallback(() => {
    const levels = agcLevelsRef.current;
    if (levels.length === 0) return;
    const parsed = levels.map(l => { const p = l.split('='); return { value: parseInt(p[0]), label: p[1] }; });
    let idx = parsed.findIndex(p => p.value === statusRef.current.agc);
    if (idx === -1) idx = 0;
    handleSetLevel("AGC", parsed[(idx + 1) % parsed.length].value);
  }, [handleSetLevel]);

  const swrTripRef = useRef<SwrTrip | null>(null);
  swrTripRef.current = swrTrip;

  const clearSwrTrip = useCallback(() => {
    socket?.emit("swr-trip-clear");
  }, [socket]);

  const handleVfoOp = useCallback((op: string) => {
    // The server refuses TUNE while SWR protection is tripped; don't start the tuning UI for it.
    if (op === "TUNE" && swrTripRef.current) return;
    const st = statusRef.current;
    if (op === "CPY") {
      skipPollsCount.current = 1;
      if (st.vfo === "VFOA") {
        setVfoB(st.frequency);
        localStorage.setItem("last-vfoB", st.frequency);
      } else {
        setVfoA(st.frequency);
        localStorage.setItem("last-vfoA", st.frequency);
      }
    }
    if (op === "TUNE") {
      if (tuningTimeoutRef.current) clearTimeout(tuningTimeoutRef.current);
      tuneSeenPTTRef.current = false;
      setIsTuning(true);
      tuneJustFinishedRef.current = false;
      setTuneJustFinished(false);
      tuningTimeoutRef.current = setTimeout(() => {
        setIsTuning(false);
        tuneJustFinishedRef.current = false;
        setTuneJustFinished(false);
        tuneSeenPTTRef.current = false;
        tuningTimeoutRef.current = null;
      }, 15000);
    }
    setPendingVfoOp(op);
    socket?.emit("vfo-op", op);
  }, [socket, setVfoA, setVfoB]);

  const handleSendRaw = useCallback((e: FormEvent) => {
    e.preventDefault();
    if (!connectedStateRef.current || !rawCommandRef.current.trim()) return;
    socket?.emit("send-raw", formatRawCommand(rawCommandRef.current));
  }, [socket]);

  const handleSetPower = useCallback((state: boolean) => {
    // Only the off-click is safe to reflect optimistically — the server sets its own state
    // synchronously in that path too, so there's no window where the two disagree. The on-click
    // must NOT flip powerState locally: the radio hasn't confirmed anything yet, and doing so
    // would make effectivelyConnected go true (un-dimming VFO/Controls/Scope) before the radio
    // is actually back. The server broadcasts powerPending / powerState via rig-status once it
    // actually knows something.
    if (!state) {
      setStatus(prev => ({ ...prev, powerState: 'off' }));
    }
    socket?.emit("set-power", { state });
  }, [socket]);

  // ── Socket events ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!socket) return;

    const onSettingsData = (data: any) => {
      vlog("[SOCKET] Received settings-data", data);
      if (data.isConnected !== undefined) setConnected(data.isConnected);
      if (data.pollRate) setPollRate(data.pollRate);
      if (data.swrProtection) setSwrProtection(data.swrProtection);
      if (data.clientHost) setHost(data.clientHost);
      if (data.clientPort) setPort(data.clientPort);
      const isAlreadyConnected = data.isConnected === true || connectedRef.current;
      if (data.autoStart && !isAlreadyConnected && !hasAttemptedAutoconnect.current) {
        if (data.autoconnectEligible === true) {
          hasAttemptedAutoconnect.current = true;
          isAutoconnectAttempt.current = true;
          const savedHost = data.clientHost || "127.0.0.1";
          const savedPort = data.clientPort || 4532;
          vlog(`[AUTOCONNECT] Attempting connection to ${savedHost}:${savedPort}`);
          socket.emit("connect-rig", { host: savedHost, port: savedPort });
        } else {
          vlog("[AUTOCONNECT] Not eligible for autoconnect");
        }
      }
    };

    const onRigConnecting = (data: { attempt: number; maxAttempts: number; auto?: boolean; knownPoweredOff?: boolean; vfo?: string; frequency?: string }) => {
      setRigConnecting(data);
      setError(null);
      if (data.knownPoweredOff) {
        // The server already knows (from a persisted record) that the radio was left off —
        // show the "powered down" state immediately instead of a generic reconnect spinner.
        // `connected` is still false here so effectivelyConnected is unaffected either way;
        // this self-corrects within moments if the radio actually got turned on in between.
        //
        // The server also hands us the VFO/frequency it last confirmed before power-off — this
        // is authoritative (captured server-side at the moment of power-off) and arrives near-
        // instantly on reconnect, well before the ~10s+ power-on handshake would otherwise leave
        // the UI showing a possibly-stale value from this browser's own localStorage cache. If
        // the server has no persisted snapshot (e.g. first run, or an older data file), fall
        // back to a neutral "unknown" VFO rather than asserting a specific — possibly wrong —
        // letter; VfoPanel renders that as "-".
        setStatus(prev => ({ ...prev, powerState: 'off', vfo: data.vfo || "" }));
        if (data.vfo === "VFOA" && data.frequency) setVfoA(data.frequency);
        else if (data.vfo === "VFOB" && data.frequency) setVfoB(data.frequency);
      }
    };

    const onRigConnected = ({ vfoSupported: vfoSup, powerSupported: powerSup }: { vfoSupported?: boolean; powerSupported?: boolean } = {}) => {
      console.log("[RIG] Connected successfully, vfoSupported:", vfoSup !== false, "powerSupported:", powerSup === true);
      setRigConnecting(null);
      setConnected(true);
      setVfoSupported(vfoSup !== false);
      setPowerSupported(powerSup === true);
      setError(null);
      socket.emit("set-autoconnect-eligible", true);
      isAutoconnectAttempt.current = false;
    };

    const onAvailableModes = (modes: string[]) => setAvailableModes(modes);

    const onRigDisconnected = () => {
      console.log("[RIG] Disconnected");
      setRigConnecting(null);
      setConnected(false);
      setVfoSupported(true);
      if (isAutoconnectAttempt.current) {
        socket.emit("set-autoconnect-eligible", false);
        isAutoconnectAttempt.current = false;
      }
    };

    const onRigError = (msg: string) => {
      console.log("[RIG] Error:", msg);
      setRigConnecting(null);
      setError(msg);
      setConnected(false);
      if (isAutoconnectAttempt.current) {
        socket.emit("set-autoconnect-eligible", false);
        isAutoconnectAttempt.current = false;
      }
    };

    const onRigOpError = (msg: string) => {
      console.log("[RIG] Op error:", msg);
      setOpError(msg);
      if (opErrorTimer.current) clearTimeout(opErrorTimer.current);
      opErrorTimer.current = setTimeout(() => setOpError(null), 4000);
    };

    const onRawResponse = (data: { cmd: string; resp: string }) => {
      setConsoleLogs(prev => [{ cmd: data.cmd, resp: data.resp, time: new Date().toLocaleTimeString() }, ...prev].slice(0, 50));
    };

    const onRigStatus = (newStatus: RigStatus) => {
      if (!newStatus) return;
      setPendingVfoOp(null);
      const wasJustFinished = tuneJustFinishedRef.current;
      if (tuningTimeoutRef.current !== null) {
        if (newStatus.ptt) {
          tuneSeenPTTRef.current = true;
        } else if (tuneSeenPTTRef.current) {
          setIsTuning(false);
          tuneJustFinishedRef.current = true;
          setTuneJustFinished(true);
          tuneSeenPTTRef.current = false;
          clearTimeout(tuningTimeoutRef.current);
          tuningTimeoutRef.current = null;
        }
      } else if (wasJustFinished) {
        tuneJustFinishedRef.current = false;
        setTuneJustFinished(false);
      }
      if (skipPollsCount.current > 0) {
        skipPollsCount.current--;
        return;
      }
      newStatus.swr = Math.max(1, newStatus.swr ?? 1);
      newStatus.smeter = Math.max(-54, Math.min(60, newStatus.smeter ?? -54));
      setStatus(prev => {
        const updated = { ...prev, ...newStatus };
        if (!updated.ptt) { updated.swr = 1.0; updated.alc = 0; }
        return updated;
      });
      if (!isDraggingRF.current && newStatus.rfpower !== undefined && newStatus.rfpower !== null) {
        setLocalRFPower(newStatus.rfpower);
      }
      if (!isDraggingRFLevel.current && newStatus.rfLevel !== undefined && newStatus.rfLevel !== null) {
        setLocalRFLevel(newStatus.rfLevel);
      }
      if (newStatus.agc !== undefined && newStatus.agc !== null) {
        setStatus(prev => ({ ...prev, agc: newStatus.agc }));
      }
      if (!isDraggingNR.current && newStatus.nrLevel !== undefined && newStatus.nrLevel !== null) {
        setLocalNRLevel(findClosestDNRValue(newStatus.nrLevel));
      }
      if (!isDraggingNB.current && newStatus.nbLevel !== undefined && newStatus.nbLevel !== null) {
        setLocalNBLevel(newStatus.nbLevel);
      }
      if (!isChangingMode.current && newStatus.mode) {
        setLocalMode(newStatus.mode);
      } else if (newStatus.mode === targetModeRef.current) {
        isChangingMode.current = false;
        if (modeTimeoutRef.current) clearTimeout(modeTimeoutRef.current);
      }
      if (newStatus.vfo === "VFOA" && newStatus.frequency) setVfoA(newStatus.frequency);
      if (newStatus.vfo === "VFOB" && newStatus.frequency) setVfoB(newStatus.frequency);
      setHistory(prev => {
        const currentPtt = newStatus.ptt !== undefined ? newStatus.ptt : pttRef.current;
        const next = [...prev, {
          time: new Date(newStatus.timestamp || Date.now()).toLocaleTimeString(),
          smeter: newStatus.smeter,
          smeterGraph: Math.min(0, newStatus.smeter ?? -54),
          swr: currentPtt ? (newStatus.swr ?? 1.0) : 1.0,
          swrGraph: Math.min(4, Math.max(1, currentPtt ? (newStatus.swr ?? 1.0) : 1.0)),
          alc: currentPtt ? (newStatus.alc ?? 0) : 0,
          powerMeter: currentPtt ? (newStatus.powerMeter ?? 0) : 0,
          vdd: newStatus.vdd,
        }];
        return next.slice(-30);
      });
    };

    const onDebugFlags = ({ rig }: { rig: boolean }) => { rigVerbose = rig; };
    const onSwrTrip = (trip: SwrTrip) => setSwrTrip(trip);
    const onSwrTripCleared = () => setSwrTrip(null);

    socket.on("settings-data", onSettingsData);
    socket.on("rig-connecting", onRigConnecting);
    socket.on("rig-connected", onRigConnected);
    socket.on("available-modes", onAvailableModes);
    socket.on("rig-disconnected", onRigDisconnected);
    socket.on("rig-error", onRigError);
    socket.on("rig-op-error", onRigOpError);
    socket.on("raw-response", onRawResponse);
    socket.on("rig-status", onRigStatus);
    socket.on("debug-flags", onDebugFlags);
    socket.on("swr-trip", onSwrTrip);
    socket.on("swr-trip-cleared", onSwrTripCleared);

    socket.emit("get-settings");
    socket.emit("get-radios");

    return () => {
      socket.off("settings-data", onSettingsData);
      socket.off("rig-connecting", onRigConnecting);
      socket.off("rig-connected", onRigConnected);
      socket.off("available-modes", onAvailableModes);
      socket.off("rig-disconnected", onRigDisconnected);
      socket.off("rig-error", onRigError);
      socket.off("rig-op-error", onRigOpError);
      socket.off("raw-response", onRawResponse);
      socket.off("rig-status", onRigStatus);
      socket.off("debug-flags", onDebugFlags);
      socket.off("swr-trip", onSwrTrip);
      socket.off("swr-trip-cleared", onSwrTripCleared);
      if (opErrorTimer.current) clearTimeout(opErrorTimer.current);
    };
  }, [socket]);

  const effectivelyConnected = connected && status?.powerState !== 'off';
  const uiConnected = connected || rigConnecting?.auto === true || rigConnecting?.knownPoweredOff === true;
  useEffect(() => { uiConnectedRef.current = uiConnected; }, [uiConnected]);

  // Populate the mode list once the rig is truly live — not merely once the socket reports
  // "connected", since a restart-restored persisted-off connection reports connected=true
  // immediately while the radio itself is still off and won't answer a live "M ?" query.
  // Also naturally re-fires on every later power-on within the session (harmless).
  useEffect(() => {
    if (effectivelyConnected) {
      socket?.emit("get-modes");
    }
  }, [effectivelyConnected, socket]);

  return {
    connected, setConnected,
    effectivelyConnected,
    uiConnected,
    vfoSupported,
    powerSupported,
    // Server-authoritative: true only while the server is actually waiting on the radio to
    // confirm power-on, and shared identically across every connected client (see rigComm.ts's
    // set-power handler). Not a locally-optimistic guess.
    poweringOn: status?.powerPending ?? false,
    handleSetPower,
    host, setHost,
    port, setPort,
    status, setStatus,
    history,
    pollRate,
    vfoA, setVfoA,
    vfoB, setVfoB,
    error,
    rigConnecting,
    opError,
    rawCommand, setRawCommand,
    consoleLogs,
    availableModes,
    vfoStep, setVfoStep,
    inputVfoA, setInputVfoA,
    inputVfoB, setInputVfoB,
    localMode,
    localRFPower, setLocalRFPower,
    localRFLevel, setLocalRFLevel,
    localNRLevel, setLocalNRLevel,
    localNBLevel, setLocalNBLevel,
    pendingVfoOp,
    isTuning,
    tuneJustFinished,
    isDraggingRF,
    isDraggingRFLevel,
    isDraggingNR,
    isDraggingNB,
    skipPollsCount,
    pttRef,
    handleConnect,
    handleSetFreq,
    adjustVfoFrequency,
    handleSetMode,
    handleSetBw,
    handleSetPTT,
    handleSetVFO,
    handleToggleSplit,
    handlePollRateChange,
    handleSetFunc,
    handleSetLevel,
    cyclePreamp,
    cycleAttenuator,
    cycleAgc,
    handleVfoOp,
    handleSendRaw,
    swrProtection,
    swrTrip,
    clearSwrTrip,
  };
}

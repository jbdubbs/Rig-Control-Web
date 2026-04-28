import { useState, useEffect, useRef } from "react";
import { Socket } from "socket.io-client";
import { CW_SETTINGS_DEFAULTS } from "../constants";
import type { CwSettings } from "../types";

interface UseCWKeyerOptions {
  socket: Socket | null;
  connected: boolean;
  localAudioOutputDevice: string;
}

export function useCWKeyer({ socket, connected, localAudioOutputDevice }: UseCWKeyerOptions) {
  // ── State ─────────────────────────────────────────────────────────────────
  const [cwSettings, setCwSettings] = useState<CwSettings>(CW_SETTINGS_DEFAULTS);
  const cwSettingsRef = useRef<CwSettings>(CW_SETTINGS_DEFAULTS);
  const [cwPortStatus, setCwPortStatus] = useState<{ open: boolean; port: string; error?: string }>({ open: false, port: "" });
  const [cwKeyActive, setCwKeyActive] = useState(false);
  const [cwStuckAlert, setCwStuckAlert] = useState(false);
  const [rebindTarget, setRebindTarget] = useState<'ditKey' | 'dahKey' | 'straightKey' | null>(null);

  // ── Refs ──────────────────────────────────────────────────────────────────
  const cwStuckAlertTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ditPressedRef = useRef(false);
  const dahPressedRef = useRef(false);
  const cwStateRef = useRef({
    machine: 'IDLE' as 'IDLE' | 'SENDING_DIT' | 'SENDING_DAH' | 'INTER_ELEMENT',
    pendingElement: null as 'dit' | 'dah' | null,
    elementEndTime: 0,
    keyIsDown: false,
  });
  const cwTickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cwConnectTimeRef = useRef<number>(performance.now());

  // ── Sidetone refs ─────────────────────────────────────────────────────────
  const sidetoneCtxRef = useRef<AudioContext | null>(null);
  const sidetoneOscRef = useRef<OscillatorNode | null>(null);
  const sidetoneGainRef = useRef<GainNode | null>(null);

  // ── Sidetone lifecycle ────────────────────────────────────────────────────
  const teardownSidetone = () => {
    sidetoneOscRef.current = null;
    sidetoneGainRef.current = null;
    if (sidetoneCtxRef.current) {
      sidetoneCtxRef.current.close().catch(() => {});
      sidetoneCtxRef.current = null;
    }
  };

  const initSidetone = async () => {
    if (sidetoneCtxRef.current) return;
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = cwSettingsRef.current.sidetoneHz;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    sidetoneCtxRef.current = ctx;
    sidetoneOscRef.current = osc;
    sidetoneGainRef.current = gain;
    if (localAudioOutputDevice && localAudioOutputDevice !== 'default' && typeof (ctx as any).setSinkId === 'function') {
      try { await (ctx as any).setSinkId(localAudioOutputDevice); } catch (e) { console.error("Sidetone setSinkId error:", e); }
    }
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
  };

  const sidetoneOn = () => {
    const ctx = sidetoneCtxRef.current;
    const gain = sidetoneGainRef.current;
    const osc = sidetoneOscRef.current;
    if (!ctx || !gain || !osc || !cwSettingsRef.current.sidetoneEnabled) return;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    osc.frequency.value = cwSettingsRef.current.sidetoneHz;
    gain.gain.cancelScheduledValues(ctx.currentTime);
    gain.gain.setValueAtTime(gain.gain.value, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(cwSettingsRef.current.sidetoneVolume, ctx.currentTime + 0.004);
  };

  const sidetoneOff = () => {
    const ctx = sidetoneCtxRef.current;
    const gain = sidetoneGainRef.current;
    if (!ctx || !gain) return;
    gain.gain.cancelScheduledValues(ctx.currentTime);
    gain.gain.setValueAtTime(gain.gain.value, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.004);
  };

  // ── CW key emission ───────────────────────────────────────────────────────
  const emitCwKey = (state: boolean) => {
    const s = cwStateRef.current;
    if (s.keyIsDown === state) return;
    s.keyIsDown = state;
    setCwKeyActive(state);
    if (state) sidetoneOn(); else sidetoneOff();
  };

  const emitCwPaddle = (dit: boolean, dah: boolean, straight: boolean) => {
    const t = performance.now() - cwConnectTimeRef.current;
    socket?.emit("cw-paddle", { dit, dah, straight, t });
  };

  // ── Keyer tick state machine ──────────────────────────────────────────────
  const startKeyerTick = () => {
    if (cwTickTimerRef.current) return;
    const tick = () => {
      const settings = cwSettingsRef.current;
      if (!settings.enabled) { cwTickTimerRef.current = null; return; }
      const ctx = sidetoneCtxRef.current;
      const now = ctx ? ctx.currentTime : performance.now() / 1000;
      const ditSec = 1.2 / settings.wpm;
      const s = cwStateRef.current;

      if (s.machine === 'IDLE') {
        if (ditPressedRef.current && !dahPressedRef.current) {
          s.machine = 'SENDING_DIT';
          s.elementEndTime = now + ditSec;
          s.pendingElement = null;
          emitCwKey(true);
        } else if (dahPressedRef.current && !ditPressedRef.current) {
          s.machine = 'SENDING_DAH';
          s.elementEndTime = now + ditSec * 3;
          s.pendingElement = null;
          emitCwKey(true);
        } else if (ditPressedRef.current && dahPressedRef.current) {
          s.machine = 'SENDING_DIT';
          s.elementEndTime = now + ditSec;
          s.pendingElement = 'dah';
          emitCwKey(true);
        }
      } else if (s.machine === 'SENDING_DIT' || s.machine === 'SENDING_DAH') {
        if (settings.mode === 'iambic-b') {
          if (s.machine === 'SENDING_DIT' && dahPressedRef.current && s.pendingElement !== 'dah') {
            s.pendingElement = 'dah';
          } else if (s.machine === 'SENDING_DAH' && ditPressedRef.current && s.pendingElement !== 'dit') {
            s.pendingElement = 'dit';
          }
        }
        if (now >= s.elementEndTime) {
          emitCwKey(false);
          s.machine = 'INTER_ELEMENT';
          s.elementEndTime = now + ditSec;
        }
      } else if (s.machine === 'INTER_ELEMENT') {
        if (now >= s.elementEndTime) {
          let next: 'dit' | 'dah' | null = null;
          if (settings.mode === 'iambic-b' && s.pendingElement) {
            next = s.pendingElement;
          } else if (ditPressedRef.current && dahPressedRef.current) {
            next = s.pendingElement === 'dah' ? 'dah' : 'dit';
          } else if (ditPressedRef.current) {
            next = 'dit';
          } else if (dahPressedRef.current) {
            next = 'dah';
          }
          s.pendingElement = null;
          if (next === 'dit') {
            s.machine = 'SENDING_DIT';
            s.elementEndTime = now + ditSec;
            if (settings.mode === 'iambic-b' && dahPressedRef.current) s.pendingElement = 'dah';
            emitCwKey(true);
          } else if (next === 'dah') {
            s.machine = 'SENDING_DAH';
            s.elementEndTime = now + ditSec * 3;
            if (settings.mode === 'iambic-b' && ditPressedRef.current) s.pendingElement = 'dit';
            emitCwKey(true);
          } else {
            s.machine = 'IDLE';
          }
        }
      }
      cwTickTimerRef.current = setTimeout(tick, Math.max(4, (1.2 / settings.wpm) * 250));
    };
    cwTickTimerRef.current = setTimeout(tick, 4);
  };

  const stopKeyerTick = () => {
    if (cwTickTimerRef.current) { clearTimeout(cwTickTimerRef.current); cwTickTimerRef.current = null; }
  };

  // ── Keyboard listener + sidetone lifecycle ────────────────────────────────
  useEffect(() => {
    const settings = cwSettingsRef.current;
    if (!settings.enabled || !connected) {
      stopKeyerTick();
      emitCwKey(false);
      ditPressedRef.current = false;
      dahPressedRef.current = false;
      teardownSidetone();
      return;
    }
    initSidetone();
    if (settings.mode !== 'straight') {
      startKeyerTick();
    }

    const isTypingTarget = (el: Element | null) => {
      if (!el) return false;
      const tag = el.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (el as HTMLElement).isContentEditable;
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(document.activeElement as Element)) return;
      if (rebindTarget) {
        e.preventDefault();
        const next = { ...cwSettingsRef.current, [rebindTarget]: e.code };
        setCwSettings(next);
        cwSettingsRef.current = next;
        socket?.emit("update-cw-settings", { [rebindTarget]: e.code });
        setRebindTarget(null);
        return;
      }
      const s = cwSettingsRef.current;
      if (s.mode === 'straight') {
        if (e.code === s.straightKey && !e.repeat) {
          e.preventDefault();
          emitCwPaddle(false, false, true);
          emitCwKey(true);
        }
      } else {
        if (e.code === s.ditKey && e.key === 'Control' && !e.repeat) {
          e.preventDefault();
          ditPressedRef.current = true;
          emitCwPaddle(true, dahPressedRef.current, false);
        } else if (e.code === s.dahKey && e.key === 'Control' && !e.repeat) {
          e.preventDefault();
          dahPressedRef.current = true;
          emitCwPaddle(ditPressedRef.current, true, false);
        }
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (isTypingTarget(document.activeElement as Element)) return;
      const s = cwSettingsRef.current;
      if (s.mode === 'straight') {
        if (e.code === s.straightKey) {
          e.preventDefault();
          emitCwPaddle(false, false, false);
          emitCwKey(false);
        }
      } else {
        if (e.code === s.ditKey) {
          ditPressedRef.current = false;
          emitCwPaddle(false, dahPressedRef.current, false);
        } else if (e.code === s.dahKey) {
          dahPressedRef.current = false;
          emitCwPaddle(ditPressedRef.current, false, false);
        }
      }
    };

    window.addEventListener('keydown', onKeyDown, { capture: true });
    window.addEventListener('keyup', onKeyUp, { capture: true });
    return () => {
      window.removeEventListener('keydown', onKeyDown, { capture: true });
      window.removeEventListener('keyup', onKeyUp, { capture: true });
      stopKeyerTick();
      emitCwPaddle(false, false, false);
      emitCwKey(false);
      ditPressedRef.current = false;
      dahPressedRef.current = false;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cwSettings.enabled, cwSettings.mode, connected, rebindTarget]);

  // Keep cwSettingsRef in sync with state
  useEffect(() => {
    cwSettingsRef.current = cwSettings;
  }, [cwSettings]);

  // ── Socket events ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!socket) return;

    const onSettingsData = (data: any) => {
      if (data.cwSettings) {
        setCwSettings(prev => {
          const next = { ...prev, ...data.cwSettings };
          cwSettingsRef.current = next;
          return next;
        });
      }
      if (data.cwPortStatus) {
        setCwPortStatus(data.cwPortStatus);
      }
    };

    const onCwPortStatus = (status: { open: boolean; port: string; error?: string }) => {
      setCwPortStatus(status);
    };

    const onCwStuckKeyAlert = () => {
      cwStateRef.current = { machine: 'IDLE', pendingElement: null, elementEndTime: 0, keyIsDown: false };
      ditPressedRef.current = false;
      dahPressedRef.current = false;
      emitCwPaddle(false, false, false);
      setCwKeyActive(false);
      sidetoneOff();
      setCwStuckAlert(true);
      if (cwStuckAlertTimerRef.current) clearTimeout(cwStuckAlertTimerRef.current);
      cwStuckAlertTimerRef.current = setTimeout(() => setCwStuckAlert(false), 8000);
    };

    const onConnect = () => {
      cwConnectTimeRef.current = performance.now();
    };

    socket.on("settings-data", onSettingsData);
    socket.on("cw-port-status", onCwPortStatus);
    socket.on("cw-stuck-key-alert", onCwStuckKeyAlert);
    socket.on("connect", onConnect);

    return () => {
      socket.off("settings-data", onSettingsData);
      socket.off("cw-port-status", onCwPortStatus);
      socket.off("cw-stuck-key-alert", onCwStuckKeyAlert);
      socket.off("connect", onConnect);
    };
  }, [socket]);

  return {
    cwSettings, setCwSettings,
    cwSettingsRef,
    cwPortStatus,
    cwKeyActive,
    cwStuckAlert, setCwStuckAlert,
    rebindTarget, setRebindTarget,
    sidetoneOscRef,
    sidetoneCtxRef,
    emitCwPaddle,
    ditPressedRef,
    dahPressedRef,
  };
}

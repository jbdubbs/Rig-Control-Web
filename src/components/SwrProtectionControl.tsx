import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { Socket } from "socket.io-client";
import { ShieldAlert, X } from "lucide-react";
import { cn } from "../utils";
import type { SwrProtectionSettings } from "../types";

const MIN_THRESHOLD = 1.1;
const MAX_THRESHOLD = 10;

// Header action for SWR protection (#128), mounted in the Controls panel header next to the PTT and
// Tune buttons it governs. The label shows the armed state at a glance ("SWR 3.0" / "SWR off").
// Settings are server-owned (the server does the unkeying), saved with a scoped `save-settings`
// emit and echoed back via `settings-data`. The dialog is portaled and fixed so the panel's
// overflow-hidden chrome can't clip it.
export default function SwrProtectionControl({
  socket,
  settings,
  dense = false,
}: {
  socket: Socket | null;
  settings: SwrProtectionSettings;
  dense?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [draft, setDraft] = useState(settings.threshold.toFixed(1));

  // Follow the server's (sanitized) value.
  useEffect(() => setDraft(settings.threshold.toFixed(1)), [settings.threshold]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isOpen]);

  const save = (next: SwrProtectionSettings) => {
    socket?.emit("save-settings", { swrProtection: next });
  };

  const commitThreshold = () => {
    const n = parseFloat(draft);
    if (!Number.isFinite(n)) {
      setDraft(settings.threshold.toFixed(1));
      return;
    }
    const clamped = Math.min(MAX_THRESHOLD, Math.max(MIN_THRESHOLD, n));
    setDraft(clamped.toFixed(1));
    if (clamped !== settings.threshold) save({ ...settings, threshold: clamped });
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        data-testid="swr-protection-button"
        title={
          settings.enabled
            ? `SWR protection on: stops TX above ${settings.threshold.toFixed(1)}:1`
            : "SWR protection off"
        }
        aria-label="SWR protection settings"
        className={cn(
          "flex items-center gap-1 px-1.5 py-0.5 rounded border font-mono font-bold uppercase transition-colors",
          dense ? "text-[0.625rem]" : "text-xs",
          settings.enabled
            ? "border-emerald-500 text-emerald-500 bg-emerald-500/10"
            : "border-line text-muted hover:text-ink hover:border-line-strong"
        )}
      >
        <ShieldAlert size={dense ? 11 : 13} />
        <span>{settings.enabled ? `SWR ${settings.threshold.toFixed(1)}` : "SWR off"}</span>
      </button>
      {isOpen &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
            onPointerDown={(e) => {
              if (e.target === e.currentTarget) setIsOpen(false);
            }}
          >
            <div
              role="dialog"
              aria-label="SWR protection"
              data-testid="swr-protection-popover"
              className="w-full max-w-xs p-4 rounded-2xl bg-panel border border-line shadow-2xl text-xs space-y-3"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 font-bold uppercase text-muted">
                  <ShieldAlert size={14} />
                  SWR protection
                </div>
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  aria-label="Close"
                  className="p-1 rounded text-muted hover:text-ink"
                >
                  <X size={14} />
                </button>
              </div>
              <label className="flex items-center justify-between gap-2 cursor-pointer">
                <span className="text-ink">Stop TX above threshold</span>
                <input
                  type="checkbox"
                  data-testid="swr-protection-enabled"
                  checked={settings.enabled}
                  onChange={(e) => save({ ...settings, enabled: e.target.checked })}
                  className="accent-emerald-500"
                />
              </label>
              <label className="flex items-center justify-between gap-2">
                <span className="text-ink">Threshold (SWR)</span>
                <input
                  type="number"
                  data-testid="swr-protection-threshold"
                  value={draft}
                  min={MIN_THRESHOLD}
                  max={MAX_THRESHOLD}
                  step={0.1}
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={commitThreshold}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                  }}
                  className="w-16 px-1.5 py-0.5 rounded bg-app border border-line text-ink font-mono text-right"
                />
              </label>
              <p className="text-faint leading-snug">
                Keying stays blocked after a trip until you clear the alert. The Tune button is
                exempt while the radio tunes. To tune from the radio's front panel, turn this off
                first. Needs a radio that reports SWR.
              </p>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}

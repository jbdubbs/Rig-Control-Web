import React, { useEffect, useState } from "react";
import type { Socket } from "socket.io-client";
import { Copy, Save, Check } from "lucide-react";
import { cn } from "../utils";
import { useDiagnostics } from "../hooks/useDiagnostics";
import type { DebugFlags } from "../types";

interface Props {
  socket: Socket | null;
}

const FLAG_LABELS: { key: keyof DebugFlags; label: string }[] = [
  { key: "rig", label: "Rig" },
  { key: "audio", label: "Audio" },
  { key: "video", label: "Video" },
  { key: "cw", label: "CW" },
  { key: "infra", label: "Infra" },
  { key: "spectrum", label: "Spectrum" },
  { key: "spots", label: "Spots" },
  { key: "dxcluster", label: "DX Cluster" },
  { key: "wsjtx", label: "WSJTX" },
  { key: "ft8", label: "FT8" },
];

export function buildFilename(): string {
  const d = new Date();
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `rigcontrol-web-diagnostics-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.txt`;
}

export function buildLogContent(logs: string[]): string {
  const header = [
    "RigControl Web Diagnostics",
    `Saved: ${new Date().toISOString()}`,
    `Origin: ${window.electron?.isElectron ? "electron" : "browser"} (${navigator.userAgent})`,
    "",
  ].join("\n");
  return header + logs.join("\n") + "\n";
}

export default function DiagnosticsTab({ socket }: Props) {
  const { logs, flags, logEndRef, requestSnapshot, toggleFlag, enableAll, clearView } = useDiagnostics(socket);
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "error">("idle");
  const [saveStatus, setSaveStatus] = useState<"idle" | "saved" | "error">("idle");

  useEffect(() => {
    requestSnapshot();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(buildLogContent(logs));
      setCopyStatus("copied");
    } catch {
      setCopyStatus("error");
    }
    setTimeout(() => setCopyStatus("idle"), 2000);
  };

  const handleSave = async () => {
    const content = buildLogContent(logs);
    const filename = buildFilename();
    try {
      if (window.electron?.isElectron && window.electron.saveTextFile) {
        const result = await window.electron.saveTextFile(content, filename);
        if (!result.ok) return;
      } else {
        const blob = new Blob([content], { type: "text/plain" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }
      setSaveStatus("saved");
    } catch {
      setSaveStatus("error");
    }
    setTimeout(() => setSaveStatus("idle"), 2000);
  };

  return (
    <div className="p-6 space-y-6">
      {/* Debug Flags */}
      <div className="space-y-3">
        <div className="flex items-center justify-between border-b border-emerald-500/20 pb-1">
          <h3 className="text-[0.625rem] uppercase text-emerald-500 font-bold">Debug Flags</h3>
          <button
            onClick={enableAll}
            className="text-[0.5rem] uppercase font-bold text-[#8e9299] hover:text-white transition-colors"
          >
            Enable All
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {FLAG_LABELS.map(({ key, label }) => (
            <label key={key} className="flex items-center gap-2 text-xs text-[#e0e0e0] cursor-pointer">
              <input
                type="checkbox"
                checked={flags[key]}
                onChange={() => toggleFlag(key)}
                className="accent-emerald-500 w-3.5 h-3.5"
              />
              {label}
            </label>
          ))}
        </div>
      </div>

      {/* Diagnostic Log */}
      <div className="space-y-2 pt-4 border-t border-[#2a2b2e]">
        <div className="flex items-center justify-between">
          <label className="text-[0.625rem] uppercase text-[#8e9299]">Diagnostic Log</label>
          <button
            onClick={clearView}
            className="text-[0.5rem] uppercase font-bold text-[#8e9299] hover:text-white transition-colors"
          >
            Clear View
          </button>
        </div>
        <div className="bg-[#0a0a0a] border border-[#2a2b2e] rounded-lg p-3 h-64 overflow-y-auto custom-scrollbar font-mono text-[0.625rem] space-y-1">
          {logs.length === 0 ? (
            <p className="text-[#4a4b4e] italic">No log lines yet...</p>
          ) : (
            logs.map((log, i) => (
              <div key={i} className="text-[#8e9299] break-all">
                {log}
              </div>
            ))
          )}
          <div ref={logEndRef} />
        </div>

        <div className="flex gap-2 pt-1">
          <button
            onClick={handleCopy}
            className={cn(
              "flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded text-[0.625rem] font-bold uppercase border transition-all",
              copyStatus === "copied"
                ? "bg-emerald-500/20 border-emerald-500 text-emerald-400"
                : "bg-[#1a1b1e] border-[#2a2b2e] text-[#8e9299] hover:text-white hover:border-emerald-500/50"
            )}
          >
            {copyStatus === "copied" ? <Check size={12} /> : <Copy size={12} />}
            {copyStatus === "copied" ? "Copied" : "Copy Log"}
          </button>
          <button
            onClick={handleSave}
            className={cn(
              "flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded text-[0.625rem] font-bold uppercase border transition-all",
              saveStatus === "saved"
                ? "bg-emerald-500/20 border-emerald-500 text-emerald-400"
                : "bg-[#1a1b1e] border-[#2a2b2e] text-[#8e9299] hover:text-white hover:border-emerald-500/50"
            )}
          >
            {saveStatus === "saved" ? <Check size={12} /> : <Save size={12} />}
            {saveStatus === "saved" ? "Saved" : "Save Log"}
          </button>
        </div>
        {copyStatus === "error" && (
          <p className="text-[0.625rem] text-red-500">Failed to copy to clipboard.</p>
        )}
        {saveStatus === "error" && (
          <p className="text-[0.625rem] text-red-500">Failed to save log file.</p>
        )}
      </div>
    </div>
  );
}

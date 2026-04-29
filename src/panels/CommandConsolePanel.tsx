import React from "react";
import { cn } from "../utils";
import type { ConsoleLog } from "../types";

export interface CommandConsolePanelProps {
  variant: "phone" | "compact" | "desktop";
  connected: boolean;
  consoleLogs: ConsoleLog[];
  rawCommand: string;
  setRawCommand: React.Dispatch<React.SetStateAction<string>>;
  handleSendRaw: (e: React.FormEvent) => void;
}

export default function CommandConsolePanel({
  variant,
  connected,
  consoleLogs,
  rawCommand,
  setRawCommand,
  handleSendRaw,
}: CommandConsolePanelProps) {
  const isPhone = variant === "phone";

  return (
    <div className="space-y-3">
      <div
        className={cn(
          "bg-[#0a0a0a] rounded border border-[#2a2b2e] overflow-y-auto font-mono text-[0.6875rem] space-y-1",
          isPhone ? "h-32 p-2" : "h-40 p-3"
        )}
      >
        {consoleLogs.length === 0 ? (
          <div className="text-[#4a4b4e] italic">
            No commands sent yet. Try "f" for frequency or "m" for mode.
          </div>
        ) : (
          consoleLogs.map((log, i) => (
            <div key={i} className="border-b border-[#1a1b1e] pb-1 last:border-0">
              <div className="flex justify-between opacity-50 text-[0.5625rem]">
                <span>{log.time}</span>
                <span>CMD: {log.cmd}</span>
              </div>
              <div className="text-emerald-500 mt-0.5">
                <span className="text-[#8e9299] mr-2">&gt;</span>
                {log.resp}
              </div>
            </div>
          ))
        )}
      </div>
      <form onSubmit={handleSendRaw} className="flex gap-2">
        <input
          type="text"
          value={rawCommand}
          onChange={(e) => setRawCommand(e.target.value)}
          disabled={!connected}
          placeholder={
            isPhone
              ? "e.g. 'f', 'm', 'v', 't'..."
              : "Enter hamlib command (e.g. 'f', 'm', 'v', 't')..."
          }
          className={cn(
            "flex-1 bg-[#0a0a0a] border border-[#2a2b2e] rounded px-3 focus:outline-none focus:border-emerald-500 transition-colors placeholder:text-[#4a4b4e]",
            isPhone ? "py-1.5 text-xs" : "py-2 text-sm",
            !connected && "opacity-50 cursor-not-allowed"
          )}
        />
        <button
          type="submit"
          disabled={!connected || !rawCommand.trim()}
          className={cn(
            "bg-emerald-500/20 text-emerald-500 border border-emerald-500/50 rounded font-bold uppercase text-xs hover:bg-emerald-500 hover:text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed",
            isPhone ? "px-4 py-1.5" : "px-5 py-2"
          )}
        >
          Send
        </button>
      </form>
    </div>
  );
}

import { useState, useEffect, useRef } from "react";
import type { Socket } from "socket.io-client";
import { Ft8Decoder, type Ft8Decode, type Ft8Depth } from '../ft8Decoder';

const MAX_DECODES = 200;
const DEPTH_STORAGE_KEY = 'ft8-decoder-depth';

function loadStoredDepth(): Ft8Depth {
  const stored = localStorage.getItem(DEPTH_STORAGE_KEY);
  return stored === 'fast' || stored === 'balanced' || stored === 'deep' ? stored : 'balanced';
}

export function useFt8Decoder(ft8DecodeEnabled: boolean, socket: Socket | null) {
  const [ft8Decodes, setFt8Decodes] = useState<Ft8Decode[]>([]);
  const [ft8Depth, setFt8DepthState] = useState<Ft8Depth>(loadStoredDepth);

  const ft8DecoderRef = useRef<Ft8Decoder | null>(null);
  const ft8DecodeEnabledRef = useRef(ft8DecodeEnabled);
  const ft8ScrollContainerRef = useRef<HTMLDivElement>(null);
  // Mirrors the "ft8" Diagnostics-tab flag (server/vlog.ts DebugFlags) — no
  // server component to this feature, but it's routed through the same
  // debug-flags broadcast as every other subsystem for a consistent toggle.
  const ft8VerboseRef = useRef(false);

  // WASM/Worker lifecycle — loads once on first enable, stays alive
  useEffect(() => {
    ft8DecodeEnabledRef.current = ft8DecodeEnabled;
    if (ft8DecodeEnabled && !ft8DecoderRef.current) {
      const decoder = new Ft8Decoder((decodes) => {
        setFt8Decodes(prev => [...prev, ...decodes].slice(-MAX_DECODES));
      });
      decoder.setDepth(ft8Depth);
      decoder.setVerbose(ft8VerboseRef.current);
      decoder.init().then(() => {
        ft8DecoderRef.current = decoder;
      });
    } else if (!ft8DecodeEnabled) {
      ft8DecoderRef.current?.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ft8DecodeEnabled]);

  useEffect(() => {
    if (!socket) return;
    const onDebugFlags = ({ ft8 }: { ft8: boolean }) => {
      ft8VerboseRef.current = ft8;
      ft8DecoderRef.current?.setVerbose(ft8);
    };
    socket.on("debug-flags", onDebugFlags);
    return () => { socket.off("debug-flags", onDebugFlags); };
  }, [socket]);

  const setFt8Depth = (depth: Ft8Depth) => {
    setFt8DepthState(depth);
    localStorage.setItem(DEPTH_STORAGE_KEY, depth);
    ft8DecoderRef.current?.setDepth(depth);
  };

  // Auto-scroll decode table to bottom on new decodes
  useEffect(() => {
    const el = ft8ScrollContainerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [ft8Decodes]);

  return {
    ft8Decodes, setFt8Decodes,
    ft8Depth, setFt8Depth,
    ft8DecoderRef,
    ft8DecodeEnabledRef,
    ft8ScrollContainerRef,
  };
}

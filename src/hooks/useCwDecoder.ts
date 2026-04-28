import { useState, useEffect, useRef } from "react";
import { GGMorseDecoder } from '../ggmorseDecoder';

export function useCwDecoder() {
  const [cwDecodeEnabled, setCwDecodeEnabled] = useState(() => localStorage.getItem('cw-decode-enabled') === 'true');
  const [cwDecodedText, setCwDecodedText] = useState('');
  const [cwWasmReady, setCwWasmReady] = useState(false);
  const [cwStats, setCwStats] = useState({ pitch: 0, speed: 0 });

  const cwDecoderRef = useRef<GGMorseDecoder | null>(null);
  const cwDecodeEnabledRef = useRef(cwDecodeEnabled);
  const cwScrollContainerRef = useRef<HTMLDivElement>(null);

  // WASM decoder lifecycle — loads once on first enable, stays alive
  useEffect(() => {
    cwDecodeEnabledRef.current = cwDecodeEnabled;
    if (cwDecodeEnabled && !cwDecoderRef.current) {
      setCwWasmReady(false);
      const decoder = new GGMorseDecoder(
        (ch) => setCwDecodedText(prev => (prev + ch).slice(-2000)),
        (pitch, speed) => setCwStats({ pitch, speed }),
      );
      decoder.init().then(() => {
        cwDecoderRef.current = decoder;
        setCwWasmReady(true);
      });
    } else if (!cwDecodeEnabled) {
      cwDecoderRef.current?.reset();
      setCwStats({ pitch: 0, speed: 0 });
    }
  }, [cwDecodeEnabled]);

  // Auto-scroll decoded text to bottom
  useEffect(() => {
    const el = cwScrollContainerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [cwDecodedText]);

  return {
    cwDecodeEnabled, setCwDecodeEnabled,
    cwDecodedText, setCwDecodedText,
    cwWasmReady,
    cwStats,
    cwDecoderRef,
    cwDecodeEnabledRef,
    cwScrollContainerRef,
  };
}

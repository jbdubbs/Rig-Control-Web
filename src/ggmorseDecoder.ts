type GGMorseModuleType = {
  _ggmorse_init: () => void;
  _ggmorse_queue_samples: (ptr: number, n: number) => void;
  _ggmorse_decode: () => number;
  _ggmorse_get_result: () => number;
  _ggmorse_get_pitch: () => number;
  _ggmorse_get_speed: () => number;
  _ggmorse_reset: () => void;
  _malloc: (bytes: number) => number;
  _free: (ptr: number) => void;
  UTF8ToString: (ptr: number) => string;
  HEAPF32: Float32Array;
};

// Single-byte tokens used in ggmorse_wrap.cpp → human-readable prosign strings
const PROSIGNS: Record<string, string> = {
  '\x01': '<AR>',
  '\x02': '<SK>',
  '\x03': '<KA>',
  '\x04': '<AS>',
  '\x05': '<BT>',
  '\x06': '<HH>',
};

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) { resolve(); return; }
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(s);
  });
}

export class GGMorseDecoder {
  private mod: GGMorseModuleType | null = null;
  private readonly onCharacter: (ch: string) => void;
  private readonly onStats: (pitch: number, speed: number) => void;

  constructor(
    onCharacter: (ch: string) => void,
    onStats: (pitch: number, speed: number) => void,
  ) {
    this.onCharacter = onCharacter;
    this.onStats = onStats;
  }

  async init(): Promise<void> {
    await loadScript('/ggmorse.js');
    this.mod = await (window as any).GGMorseModule({
      locateFile: (file: string) => `/${file}`,
    }) as GGMorseModuleType;
    this.mod._ggmorse_init();
  }

  processSamples(pcm: Float32Array): void {
    const m = this.mod;
    if (!m) return;

    // Copy PCM into WASM heap, queue, then run decoder
    const bytes = pcm.length * 4;
    const ptr = m._malloc(bytes);
    m.HEAPF32.set(pcm, ptr >>> 2);
    m._ggmorse_queue_samples(ptr, pcm.length);
    m._free(ptr);

    const nChars = m._ggmorse_decode();
    if (nChars > 0) {
      const text = m.UTF8ToString(m._ggmorse_get_result());
      for (const ch of text) {
        this.onCharacter(PROSIGNS[ch] ?? ch);
      }
    }

    const pitch = m._ggmorse_get_pitch();
    const speed = m._ggmorse_get_speed();
    if (pitch > 0 || speed > 0) {
      this.onStats(pitch, speed);
    }
  }

  reset(): void {
    this.mod?._ggmorse_reset();
  }
}

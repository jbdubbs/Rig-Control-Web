export {};

declare global {
  interface Window {
    electron?: {
      isElectron?: boolean;
      resizeWindow?: (width: number, height: number) => void;
      setZoomFactor?: (factor: number) => void;
      getZoomFactor?: () => number;
      onOutboundAudio?: (callback: (data: Uint8Array) => void) => void;
      saveTextFile?: (content: string, defaultFilename: string) => Promise<{ ok: boolean; path?: string }>;
    };
  }
}

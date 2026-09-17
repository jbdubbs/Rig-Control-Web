import { amplitudeToPixel } from "./spectrumColors";

export function lsGet(key: string, fallback: string): string {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}
export function lsSet(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* ignore */ }
}

export function drawDbGridLines(ctx: CanvasRenderingContext2D, w: number, h: number, effFloor: number, effCeiling: number): void {
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.lineWidth = 1;
  for (let db = Math.ceil(effFloor / 10) * 10; db <= effCeiling; db += 10) {
    const y = h - ((db - effFloor) / (effCeiling - effFloor)) * h;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
}

// vertexCount/xAt/valueAt let each caller preserve its own exact iteration order (per-data-point
// vs per-canvas-column) and x-mapping — only the normalize+path+fill+stroke shell is shared.
export function drawFilledSpectrumLine(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  vertexCount: number,
  xAt: (i: number) => number,
  valueAt: (i: number) => number,
  effFloor: number,
  effCeiling: number,
  strokeStyle: string,
  fillStyle: string,
): void {
  ctx.beginPath();
  ctx.strokeStyle = strokeStyle;
  ctx.fillStyle = fillStyle;
  ctx.lineWidth = 1.5;
  for (let i = 0; i < vertexCount; i++) {
    const norm = Math.max(0, Math.min(1, (valueAt(i) - effFloor) / (effCeiling - effFloor)));
    const x = xAt(i);
    const y = h - norm * h;
    if (i === 0) { ctx.moveTo(x, h); ctx.lineTo(x, y); } else { ctx.lineTo(x, y); }
  }
  ctx.lineTo(w, h);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

// Writes exactly `w` pixels into rowBuf (a Uint32Array, or a subarray view into a larger
// ImageData buffer for the full-repaint case). effectiveLength is the divisor for `step` —
// a caller passes its full row length to display the whole row, or a sub-range (e.g. a
// bandwidth-limited bin count) to display only a portion of it.
export function paintWaterfallRow(
  rowBuf: Uint32Array,
  line: ArrayLike<number>,
  effectiveLength: number,
  w: number,
  toDb: (raw: number) => number,
  effFloor: number,
  effCeiling: number,
  colorMap: Uint32Array,
): void {
  const step = effectiveLength / w;
  for (let col = 0; col < w; col++) {
    const idx = Math.min(effectiveLength - 1, Math.floor(col * step));
    const db = toDb(line[idx]);
    const norm = Math.max(0, Math.min(1, (db - effFloor) / (effCeiling - effFloor)));
    rowBuf[col] = amplitudeToPixel(Math.round(norm * 255), 0, 255, colorMap);
  }
}

// One-time full-history repaint: builds one ImageData covering min(lines.length, wh) rows and
// blits it in a single putImageData call. Use this when effectiveLength is the same for every
// row; if row lengths can vary, paint each row individually with paintWaterfallRow instead.
export function paintWaterfallFull(
  wfCtx: CanvasRenderingContext2D,
  w: number,
  wh: number,
  lines: ArrayLike<number>[],
  effectiveLength: number,
  toDb: (raw: number) => number,
  effFloor: number,
  effCeiling: number,
  colorMap: Uint32Array,
): void {
  const visibleLines = Math.min(lines.length, wh);
  const imageData = wfCtx.createImageData(w, wh);
  const buf32 = new Uint32Array(imageData.data.buffer);
  for (let row = 0; row < visibleLines; row++) {
    paintWaterfallRow(buf32.subarray(row * w, row * w + w), lines[row], effectiveLength, w, toDb, effFloor, effCeiling, colorMap);
  }
  wfCtx.putImageData(imageData, 0, 0);
}

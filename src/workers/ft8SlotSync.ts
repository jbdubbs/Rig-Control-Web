// Pure decision extracted from ft8Decoder.worker.ts for unit testing (a Worker's
// module-level state can't be exercised directly by Vitest) — mirrors why
// ft8ResultParser.ts was split out of the same file.
//
// The worker anchors its 15s UTC slot-boundary tracking to wall-clock time only
// once (on the first sample chunk after init/reset) and from then on advances
// it purely by counting consumed samples. If the incoming sample stream stalls
// for any reason (a backgrounded/frozen tab, a reclaimed WebCodecs decoder, a
// brief socket hiccup) and then resumes, that arithmetic clock has silently
// fallen behind real time — the worker has no way to notice on its own, and
// FT8 needs sub-second UTC alignment to decode anything, so it would otherwise
// keep "running" while never decoding again until the page is reloaded.
export const FT8_RESYNC_GAP_MS = 2000;

export function shouldResyncSlot(lastChunkWallClockMs: number | null, nowMs: number): boolean {
  return lastChunkWallClockMs !== null && (nowMs - lastChunkWallClockMs) > FT8_RESYNC_GAP_MS;
}

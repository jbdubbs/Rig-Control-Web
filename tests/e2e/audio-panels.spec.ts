import path from 'path';
import { fileURLToPath } from 'url';
import { test, expect, type Page } from '@playwright/test';
import { startDummyRigctld, type DummyRigctld } from '../fixtures/rigctld-dummy.ts';
import { connectToDummy, disconnectFromDummy } from './connect-helper.ts';
import { LOOPBACK_INPUT_NAME, LOOPBACK_OUTPUT_NAME } from '../fixtures/audio-loopback.ts';
import { DEFAULT_COMPACT_LAYOUT, DEFAULT_PHONE_LAYOUT } from '../../src/hooks/useLayoutConfig.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');

// Runs under the 'audio-fake-device' Playwright project (fake mic device,
// see playwright.config.ts). Backend audio (server/audio.ts's naudiodon)
// talks to the PipeWire loopback spawned once in global-setup.ts
// (tests/fixtures/audio-loopback.ts) — the same pw-loopback tool
// wsjtx-bridge.c already uses in production, no PulseAudio server involved.
//
// This test needed several real, empirically-discovered pieces of
// server/audio.ts's behavior to line up correctly — all deliberate,
// half-duplex-radio-shaped design, not bugs:
//
// 1. PTT must be on: startAudio()'s outbound-playback interval only writes
//    real jitter-buffer frames (the browser's mic audio) to the backend
//    OUTPUT device while ctx.lastStatus.ptt is true; otherwise it always
//    writes silence (don't send mic audio to the radio's TX input while not
//    transmitting).
// 2. The outbound mic must be explicitly unmuted (outboundMuted defaults to
//    true): the audio-outbound handler only decodes/queues PCM for the
//    current "active mic client" (set via mic-unmute-request).
// 3. The rig mode must be CW: the inbound relay (naudiodon capture -> browser,
//    what feeds SpectrumAudioPanel's AnalyserNode) is deliberately skipped
//    while `activeMicClientId && ptt && mode is not CW` — i.e. don't relay
//    receive audio back to the browser while transmitting, EXCEPT in CW
//    modes, where a normal radio still expects sidetone/monitor feedback
//    while keying. Any other mode (the Dummy rig's default is FM) would
//    starve the inbound path for the entire time PTT is on, and the
//    spectrum canvas would never see live data.
// 4. Chromium's default fake mic (no --use-file-for-fake-audio-capture) is
//    silent, not a tone — a real WAV fixture (fake-audio-wav.ts) is
//    required to prove the signal actually moves.
// 5. Audio Enhancements (echoCancellation/noiseSuppression/autoGainControl,
//    default on) is speech-tuned DSP that suppresses a pure synthetic test
//    tone almost entirely — same reason the app itself forces this off for
//    WSJTX/digital-mode sessions (CLAUDE.md's Audio Pipeline section).
// 6. "Start Backend Audio" always emits a transient "audio-status":"stopped"
//    before the real "playing" (startAudio() server-side always calls
//    stopAudio() first to tear down any prior streams), and the client's
//    onAudioStatus handler unconditionally resets localAudioReady to false
//    on any "stopped" event. Since useAudio.ts now auto-joins local audio
//    once the page has seen any gesture (issue #51 — see the auto-join
//    effects around initLocalAudioPipeline), the "Join Audio" button that
//    reappears when audioStatus settles back to "playing" is usually
//    already gone again by the time the test would click it (this spec has
//    already driven several real clicks by then). The click below is a
//    best-effort fallback, not a required step.
//
// Full round trip: browser fake mic (WAV file) -> Opus -> naudiodon OUTPUT
// (plays directly into the loopback's named sink node) -> PipeWire loop ->
// naudiodon INPUT (captures via the generic ALSA "pipewire" device, with the
// loopback's paired source made the WirePlumber default source — see
// audio-loopback.ts for why the named source node can't be opened directly)
// -> Opus -> browser audio-inbound -> AudioWorklet playback -> the shared
// AnalyserNode SpectrumAudioPanel reads.

const layoutWithSpectrumAudio = {
  compact: {
    ...DEFAULT_COMPACT_LAYOUT,
    items: [
      ...DEFAULT_COMPACT_LAYOUT.items,
      { i: 'spectrum_audio', x: 0, y: DEFAULT_COMPACT_LAYOUT.rows, w: 1, h: 1, minW: 1, minH: 1, panelType: 'spectrum_audio' as const },
    ],
  },
  phone: DEFAULT_PHONE_LAYOUT,
};

// AudioSettingsModal's "Backend Audio Engine" section (the Backend
// Input/Output selects live inside it) auto-collapses whenever audioStatus
// === "playing" (useAudio.ts) — including immediately on mount if it's
// *already* playing when the page loads. ctx.audioStatus (server/audio.ts)
// is shared mutable state across the whole suite (one server process,
// workers:1), so if some earlier spec left the engine running, this
// section starts collapsed and the Backend Input/Output <select>s never
// render — confirmed via server-side heartbeat logging that the server
// itself isn't blocked, just this UI section. This spec starts from a
// clean "stopped" state when run alone, so this is normally a no-op, but
// stays here defensively for whatever runs after it in the suite.
async function ensureBackendEngineExpanded(page: Page) {
  const inputLabel = page.locator('label:text-is("Backend Input (Mic/Line)")');
  if (await inputLabel.isVisible().catch(() => false)) return;
  await page.getByText('Backend Audio Engine', { exact: true }).click();
  await expect(inputLabel).toBeVisible({ timeout: 5_000 });
}

// Selects the <option> whose visible label contains `deviceName` (the label
// also carries a [hostAPI, rate] suffix we don't want to assume the exact
// text of) by reading its `value` attribute (the resolveDeviceId()-shaped
// JSON string) rather than hardcoding it.
//
// Re-checks ensureBackendEngineExpanded() immediately before every
// interaction, not just once up front: while audioStatus was already
// "playing" on page load (inherited from a previous spec), each device
// selection's update-audio-settings round trip triggers server/audio.ts's
// `if (wasPlaying) startAudio(ctx)` — a full stop-then-restart — and each
// "stopped"->"playing" cycle re-fires the same auto-collapse effect,
// re-hiding this section between selections. Confirmed empirically: without
// re-checking here, the second selectDeviceByName call (or the "Start
// Backend Audio" click after both) hits a detached/re-mounted button.
async function selectDeviceByName(page: Page, labelText: string, deviceName: string) {
  await ensureBackendEngineExpanded(page);
  const select = page.locator(`label:text-is("${labelText}")`).locator('xpath=../following-sibling::select[1]');
  await select.focus(); // triggers get-audio-devices (onFocus)
  const option = select.locator('option', { hasText: deviceName });
  await expect(option).toHaveCount(1, { timeout: 10_000 });
  const value = await option.getAttribute('value');
  await select.selectOption(value!);
}

test.describe('AudioFeedPanel + SpectrumAudioPanel via a PipeWire loopback', () => {
  let dummy: DummyRigctld;

  test.beforeAll(async () => {
    dummy = await startDummyRigctld(REPO_ROOT);
  });

  test.afterAll(async () => {
    await dummy.stop();
  });

  test('backend audio round-trips through the loopback (PTT + CW mode) and drives the spectrum canvas', async ({ page }) => {
    await page.addInitScript((cfg) => {
      localStorage.setItem('grid-layout-v1', JSON.stringify(cfg));
      // handleJoinAudio (useAudio.ts) only calls initLocalAudioPipeline()
      // directly if a local device was already configured at least once —
      // otherwise it just opens Audio Settings instead of joining.
      localStorage.setItem('local-audio-input', 'default');
      localStorage.setItem('local-audio-output', 'default');
      localStorage.setItem('local-audio-enhancements', 'false');
    }, layoutWithSpectrumAudio);

    await page.goto('/');
    await connectToDummy(page, dummy);

    // CW mode is required for the inbound relay to stay alive while PTT is
    // on — see point 3 in the comment block above.
    const modeSelect = page.getByTestId('modebw-mode-select-compact');
    await modeSelect.selectOption('CW');
    await expect(modeSelect).toHaveValue('CW', { timeout: 10_000 });

    const ptt = page.getByTestId('controls-ptt-button');
    await expect(ptt).toBeEnabled();
    await ptt.click();
    await expect(ptt).toHaveClass(/border-red-500/, { timeout: 10_000 });

    await page.getByTitle('Audio Settings').click();
    await selectDeviceByName(page, 'Backend Input (Mic/Line)', LOOPBACK_INPUT_NAME);
    await selectDeviceByName(page, 'Backend Output (Speakers)', LOOPBACK_OUTPUT_NAME);
    await ensureBackendEngineExpanded(page);

    await page.getByRole('button', { name: 'Start Backend Audio', exact: true }).click();
    // Modal's own close button — not "Stop Backend Audio", which also
    // renders a lucide X icon (with visible text), so scope to the header's
    // icon-only close button by taking the first match (it's first in DOM
    // order, before the body content).
    await page.locator('button:has(svg.lucide-x)').first().click();

    const joinAudioButton = page.getByTitle('Join the active audio session');
    if (await joinAudioButton.isVisible().catch(() => false)) {
      await joinAudioButton.click();
    }
    await expect(page.getByTitle('Mute Inbound Audio')).toBeEnabled({ timeout: 15_000 });
    await page.getByTitle('Unmute Outbound Audio').click();

    const panel = page.locator(
      'xpath=//span[normalize-space(text())="Audio Waterfall"]/ancestor::div[contains(@class,"rounded-xl")][1]',
    );
    const canvas = panel.locator('canvas').first();
    await expect(canvas).toBeVisible({ timeout: 10_000 });

    async function canvasFingerprint(): Promise<number> {
      return canvas.evaluate((el: HTMLCanvasElement) => {
        const ctx = el.getContext('2d')!;
        const { data } = ctx.getImageData(0, 0, el.width, el.height);
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i];
        return sum;
      });
    }

    const first = await canvasFingerprint();
    await expect.poll(canvasFingerprint, { timeout: 15_000 }).not.toBe(first);

    await ptt.click();
    await expect(ptt).not.toHaveClass(/border-red-500/, { timeout: 10_000 });

    // ctx.audioStatus (server/audio.ts) is shared mutable state across the
    // whole suite (one server process, workers:1). Leaving it "playing"
    // means the next real-audio spec (cw-decode-panel.spec.ts) inherits
    // audioStatus === "playing" on page load, so *every* device selection
    // it makes triggers update-audio-settings's `if (wasPlaying)
    // startAudio(ctx)` — a real naudiodon stream stop+restart per
    // selection, stacked back-to-back, which was enough to destabilize the
    // renderer badly enough to drop its own WebSocket connection
    // (confirmed via server-side connect/disconnect logging: no server-side
    // hang, the socket just never reconnected). Stopping explicitly here
    // means the next spec starts from a clean "stopped" state instead.
    await page.getByTitle('Audio Settings').click();
    await ensureBackendEngineExpanded(page);
    await page.getByRole('button', { name: 'Stop Backend Audio', exact: true }).click();
    await page.locator('button:has(svg.lucide-x)').first().click();

    await disconnectFromDummy(page);
  });
});

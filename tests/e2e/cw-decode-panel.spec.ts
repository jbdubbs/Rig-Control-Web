import path from 'path';
import { fileURLToPath } from 'url';
import { test, expect, type Page } from '@playwright/test';
import { startDummyRigctld, type DummyRigctld } from '../fixtures/rigctld-dummy.ts';
import { connectToDummy, disconnectFromDummy } from './connect-helper.ts';
import { LOOPBACK_INPUT_NAME, LOOPBACK_OUTPUT_NAME } from '../fixtures/audio-loopback.ts';
import { DEFAULT_COMPACT_LAYOUT, DEFAULT_PHONE_LAYOUT } from '../../src/hooks/useLayoutConfig.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');

// Runs under the 'cw-decode-fake-audio' Playwright project (fake mic fed a
// PARIS-timed "VVV" WAV — tests/fixtures/fake-audio-wav.ts), reusing the
// same PipeWire loopback (tests/fixtures/audio-loopback.ts) and PTT/CW-mode/
// unmute/Join-Audio sequencing worked out in audio-panels.spec.ts (see that
// file's top comment for the full list of why each step is needed — this
// spec doesn't repeat that detail). Also reuses that file's
// ensureBackendEngineExpanded() helper — see its definition there for why
// it's needed (audioStatus is shared server state across the whole suite,
// and this spec normally runs after audio-panels.spec.ts leaves it
// "playing").
//
// CwDecodePanel's decoder ('cwdecode' panel type, see App.tsx's
// hasCwDecodePanel/useCwDecoder(hasCwDecodePanel)) is enabled purely by
// being present in the layout — no separate settings toggle — and it taps
// the exact same inbound-audio pipeline (decoded audio-inbound Opus ->
// Float32Array PCM) that feeds the AnalyserNode in audio-panels.spec.ts, so
// once that round trip works, GGMorse just needs a Morse-shaped signal
// instead of a plain tone.

const layoutWithCwDecode = {
  compact: {
    ...DEFAULT_COMPACT_LAYOUT,
    items: [
      ...DEFAULT_COMPACT_LAYOUT.items,
      { i: 'cwdecode', x: 0, y: DEFAULT_COMPACT_LAYOUT.rows, w: 1, h: 1, minW: 1, minH: 1, panelType: 'cwdecode' as const },
    ],
  },
  phone: DEFAULT_PHONE_LAYOUT,
};

// AudioSettingsModal's "Backend Audio Engine" section (Backend Input/Output
// selects live inside it) auto-collapses whenever audioStatus === "playing"
// (useAudio.ts) — including immediately on mount if it's *already* playing
// when the page loads, which is exactly what happens here: ctx.audioStatus
// (server/audio.ts) is shared mutable state across the whole suite, and
// this spec normally runs after audio-panels.spec.ts, which leaves it
// "playing" (that spec never explicitly stops the engine). Without this,
// the Backend Input/Output <select>s never render, and selecting them just
// hangs waiting for elements that don't exist — confirmed via server-side
// heartbeat logging that the server itself was never blocked, only this
// section was collapsed.
async function ensureBackendEngineExpanded(page: Page) {
  const inputLabel = page.locator('label:text-is("Backend Input (Mic/Line)")');
  if (await inputLabel.isVisible().catch(() => false)) return;
  await page.getByText('Backend Audio Engine', { exact: true }).click();
  await expect(inputLabel).toBeVisible({ timeout: 5_000 });
}

// Re-checks ensureBackendEngineExpanded() immediately before every
// interaction, not just once up front: while audioStatus was already
// "playing" on page load (inherited from audio-panels.spec.ts), each device
// selection's update-audio-settings round trip triggers server/audio.ts's
// `if (wasPlaying) startAudio(ctx)` — a full stop-then-restart — and each
// "stopped"->"playing" cycle re-fires the same auto-collapse effect,
// re-hiding this section between selections. Confirmed empirically: without
// re-checking here, the second selectDeviceByName call (or the "Start
// Backend Audio" click after both) hits a detached/re-mounted button.
async function selectDeviceByName(page: Page, labelText: string, deviceName: string) {
  await ensureBackendEngineExpanded(page);
  const select = page.locator(`label:text-is("${labelText}")`).locator('xpath=../following-sibling::select[1]');
  await select.focus();
  const option = select.locator('option', { hasText: deviceName });
  await expect(option).toHaveCount(1, { timeout: 10_000 });
  const value = await option.getAttribute('value');
  await select.selectOption(value!);
}

test.describe('CwDecodePanel via a PipeWire loopback fed a Morse-timed WAV', () => {
  let dummy: DummyRigctld;

  test.beforeAll(async () => {
    dummy = await startDummyRigctld(REPO_ROOT);
  });

  test.afterAll(async () => {
    await dummy.stop();
  });

  test('decodes "VVV" from the looped-back Morse signal', async ({ page }) => {
    test.setTimeout(60_000);

    await page.addInitScript((cfg) => {
      localStorage.setItem('grid-layout-v1', JSON.stringify(cfg));
      localStorage.setItem('local-audio-input', 'default');
      localStorage.setItem('local-audio-output', 'default');
      localStorage.setItem('local-audio-enhancements', 'false');
    }, layoutWithCwDecode);

    await page.goto('/');
    await connectToDummy(page, dummy);

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
    await page.locator('button:has(svg.lucide-x)').first().click();

    // useAudio.ts now auto-joins local audio once the page has seen any
    // gesture (issue #51) — by this point in the spec that's already
    // happened several times over, so the button is usually already gone.
    // See audio-panels.spec.ts's point 6 for the full explanation.
    const joinAudioButton = page.getByTitle('Join the active audio session');
    if (await joinAudioButton.isVisible().catch(() => false)) {
      await joinAudioButton.click();
    }
    await expect(page.getByTitle('Mute Inbound Audio')).toBeEnabled({ timeout: 15_000 });
    await page.getByTitle('Unmute Outbound Audio').click();

    const panel = page.locator(
      'xpath=//span[normalize-space(text())="CW Decode"]/ancestor::div[contains(@class,"rounded-xl")][1]',
    );
    await expect(panel).toBeVisible();

    // GGMorse WASM loads lazily on first enable (useCwDecoder.ts) and then
    // needs real time to actually decode a full repetition of the fixture
    // (~4s per "VVV" pass at 18 WPM plus lead-in/word gaps) — generous
    // timeout to absorb WASM init + at least one full pass.
    await expect(panel).toContainText('V', { timeout: 40_000 });

    await ptt.click();
    await expect(ptt).not.toHaveClass(/border-red-500/, { timeout: 10_000 });

    // See audio-panels.spec.ts's matching cleanup for why this matters —
    // leaves the engine stopped so whatever runs after this spec doesn't
    // inherit a "playing" state either.
    await page.getByTitle('Audio Settings').click();
    await ensureBackendEngineExpanded(page);
    await page.getByRole('button', { name: 'Stop Backend Audio', exact: true }).click();
    await page.locator('button:has(svg.lucide-x)').first().click();

    await disconnectFromDummy(page);
  });
});

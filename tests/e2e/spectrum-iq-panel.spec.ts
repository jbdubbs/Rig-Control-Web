import path from 'path';
import { fileURLToPath } from 'url';
import { test, expect } from '@playwright/test';
import { startDummyRigctld, type DummyRigctld } from '../fixtures/rigctld-dummy.ts';
import { connectToDummy, disconnectFromDummy } from './connect-helper.ts';
import { startIqLoopback, stopIqLoopback, IQ_LOOPBACK_SINK_NAME, IQ_LOOPBACK_INPUT_NAME } from '../fixtures/iq-loopback.ts';
import { startIqTonePlayer, stopIqTonePlayer } from '../fixtures/iq-tone-player.ts';
import { DEFAULT_COMPACT_LAYOUT, DEFAULT_PHONE_LAYOUT } from '../../src/hooks/useLayoutConfig.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');

// Full-signal-verification coverage for the "Audio I/Q" spectrum source
// (server/iqScope.ts): a real naudiodon capture stream reads from a real
// PipeWire loopback (tests/fixtures/iq-loopback.ts, distinct from the mono
// loopback tests/fixtures/audio-loopback.ts uses for AudioFeedPanel/
// SpectrumAudioPanel/CwDecodePanel), fed by a synthetic complex-tone player
// (tests/fixtures/iq-tone-player.ts) driving naudiodon directly rather than
// an external player binary. This exercises the real capture -> FFT ->
// spectrum-data -> canvas path end to end, hardware-independent.
//
// Like spectrum-hamlib-panel.spec.ts, this asserts via a canvas pixel
// "fingerprint" changing between states rather than parsing an exact
// numeric peak bin out of rendered pixels — the same pragmatic bar the
// other spectrum specs already use (server/iqScope.test.ts already covers
// exact peak-bin math with the pure buildIqSpectrumFrame() function).
// Clicks `locator` and retries the click (not just the wait) until
// `check` passes — confirmed via trace inspection that under full-suite
// load a single click can occasionally fail to register (or its effect
// gets clobbered by a same-tick re-render) with no error surfaced by
// Playwright's own actionability checks, leaving the toggle/button
// visibly unchanged indefinitely. Retrying the click itself, not just
// re-checking, is what makes this self-healing.
async function clickUntil(
  locator: import('@playwright/test').Locator,
  check: () => Promise<void>,
  timeout = 15_000,
): Promise<void> {
  await locator.click();
  await expect(async () => {
    try {
      await check();
    } catch (err) {
      await locator.click();
      throw err;
    }
  }).toPass({ timeout });
}

// Robust to whatever state the settings modal is in (open, closed, mid
// interaction) after either a clean pass or a failed assertion above —
// opens the modal if needed, turns Enable Spectrum Scope off if it's on,
// and closes the modal again. Best-effort: callers catch and ignore
// failures here rather than letting cleanup mask the real test failure.
async function disableSpectrumScope(page: import('@playwright/test').Page): Promise<void> {
  const enableToggle = page
    .locator('div.flex.items-center.justify-between', { hasText: 'Enable Spectrum Scope' })
    .getByRole('button');

  if (!(await enableToggle.isVisible().catch(() => false))) {
    const gear = page.getByTitle('Spectrum scope settings');
    if (!(await gear.isVisible().catch(() => false))) return; // panel itself isn't present; nothing to clean up
    await gear.click();
    await expect(enableToggle).toBeVisible({ timeout: 10_000 });
  }

  const cls = await enableToggle.getAttribute('class');
  if (cls?.includes('bg-emerald-500')) {
    await clickUntil(enableToggle, async () => {
      await expect(enableToggle).not.toHaveClass(/bg-emerald-500/);
    });
    // No observable client-side signal for "the server finished closing
    // ctx.iqCaptureProcess" — the status indicator block only renders while
    // spectrumSettings.enabled is true, so it unmounts the instant the
    // toggle flips off. A short settle window here (this is cleanup, not a
    // correctness assertion) gives stopIqScope()'s awaited naudiodon
    // quit() time to actually finish before the caller tears down the
    // PipeWire loopback nodes underneath it.
    await page.waitForTimeout(800);
  }

  await page.locator('button:has(svg.lucide-x)').click();
}

function canvasFingerprint(canvas: import('@playwright/test').Locator): Promise<number> {
  return canvas.evaluate((el: HTMLCanvasElement) => {
    const ctx = el.getContext('2d')!;
    const { data } = ctx.getImageData(0, 0, el.width, el.height);
    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += data[i];
    return sum;
  });
}

test.describe('SpectrumHamlibPanel Audio I/Q source via a PipeWire loopback', () => {
  let dummy: DummyRigctld;

  test.beforeAll(async () => {
    dummy = await startDummyRigctld(REPO_ROOT);
    await startIqLoopback();
  });

  test.afterAll(async () => {
    stopIqTonePlayer();
    await stopIqLoopback();
    await dummy.stop();
  });

  test('renders and live-updates the waterfall once a real synthetic I/Q tone starts flowing', async ({ page }) => {
    // Above the default 30s test timeout: this spec chains more sequential
    // settings round trips than most panel specs (source, device, enable,
    // each individually waited-on to avoid a stale-closure race — see
    // comments below), plus up to a 15s wait for the tone player's signal
    // to show up in the waterfall. Under full-suite load the cumulative
    // worst case can exceed 30s even though each individual step is fast
    // in isolation.
    test.setTimeout(90_000);

    // Explicitly injected rather than relying on the app's ambient default
    // layout — guarantees the Spectrum Scope panel is present regardless of
    // whatever layout state a differently-configured earlier spec in the
    // same run may have left behind, same defensive pattern most other
    // specs already use (e.g. audio-panels.spec.ts's layoutWithSpectrumAudio).
    await page.addInitScript((cfg) => {
      localStorage.setItem('grid-layout-v1', JSON.stringify(cfg));
      // Layout storage is keyed by the signed-in callsign (useLayoutConfig); the e2e user is ADMIN.
      localStorage.setItem('ADMIN:grid-layout-v1', JSON.stringify(cfg));
    }, { compact: DEFAULT_COMPACT_LAYOUT, phone: DEFAULT_PHONE_LAYOUT });

    await page.goto('/');
    await connectToDummy(page, dummy);

    try {
      await page.getByTitle('Spectrum scope settings').click();

      // Each of these three edits round-trips through save-settings ->
      // settings-data, which the panel merges into its spectrumSettings
      // prop (useSpectrum.ts). Under full-suite load a single click can
      // occasionally not register (or get clobbered by a same-tick
      // re-render, e.g. a stale-closure race like the one
      // spectrum-hamlib-panel.spec.ts's multicast address/port edits guard
      // against) with no error from Playwright's own actionability checks —
      // confirmed via trace inspection. clickUntil() retries the click
      // itself, not just the wait, so it self-heals from that.
      const sourceButton = page.getByRole('button', { name: 'Audio I/Q', exact: true });
      await clickUntil(sourceButton, async () => {
        await expect(sourceButton).toHaveClass(/bg-emerald-600/);
      });

      // Select the loopback's generic ALSA passthrough device — same device
      // name/selection pattern as audio-panels.spec.ts's selectDeviceByName.
      const deviceSelect = page.locator('div.space-y-2:has(label:text-is("Capture Device")) select');
      await deviceSelect.focus(); // triggers get-audio-devices (onFocus)
      const option = deviceSelect.locator('option', { hasText: IQ_LOOPBACK_INPUT_NAME });
      await expect(option).toHaveCount(1, { timeout: 10_000 });
      const value = await option.getAttribute('value');
      await expect(async () => {
        await deviceSelect.selectOption(value!);
        await expect(deviceSelect).toHaveValue(value!);
      }).toPass({ timeout: 15_000 });

      // Enable last, so the first real start already has a device configured
      // (server.ts's settings-changed callback stops-all-then-starts-active on
      // every spectrumSettings save).
      const enableToggle = page
        .locator('div.flex.items-center.justify-between', { hasText: 'Enable Spectrum Scope' })
        .getByRole('button');
      await clickUntil(enableToggle, async () => {
        await expect(enableToggle).toHaveClass(/bg-emerald-500/);
      });

      // Wait for the SERVER to actually confirm the capture stream opened
      // (not just the client's optimistic enabled=true) — this status
      // indicator only exists while the settings modal is open (it's part
      // of settingsModal's JSX, not the panel body), so it must be checked
      // here, before closing the modal below. Re-toggling Enable off/on
      // forces server.ts's settings-changed callback to retry
      // startIqScope(), in case PipeWire's channel negotiation for the
      // just-created loopback node needed a moment to settle (same root
      // cause tests/fixtures/iq-tone-player.ts retries around for its own
      // open).
      const runningText = page.getByText('Capture running', { exact: true });
      await expect(async () => {
        if (await runningText.isVisible().catch(() => false)) return;
        await clickUntil(enableToggle, async () => {
          await expect(enableToggle).not.toHaveClass(/bg-emerald-500/);
        });
        await clickUntil(enableToggle, async () => {
          await expect(enableToggle).toHaveClass(/bg-emerald-500/);
        });
        throw new Error('waiting for server-confirmed I/Q capture to start');
      }).toPass({ timeout: 30_000 });

      await page.locator('button:has(svg.lucide-x)').click();

      const panel = page.locator(
        'xpath=//span[normalize-space(text())="Spectrum Scope"]/ancestor::div[contains(@class,"rounded-xl")][1]',
      );
      const spectrumCanvas = panel.locator('canvas').first();
      await expect(spectrumCanvas).toBeVisible({ timeout: 10_000 });

      // Baseline: whatever the (near-silent) loopback capture renders before
      // any real tone is injected.
      const baseline = await canvasFingerprint(spectrumCanvas);

      await startIqTonePlayer(IQ_LOOPBACK_SINK_NAME);

      await expect(async () => {
        expect(await canvasFingerprint(spectrumCanvas)).not.toBe(baseline);
      }).toPass({ timeout: 15_000 });
    } finally {
      // Disable the spectrum scope before disconnecting/tearing down —
      // otherwise ctx.iqCaptureProcess (server/iqScope.ts) stays open on
      // the shared server process (one webServer instance for the whole
      // suite) into whichever spec runs next, and afterAll's
      // stopIqLoopback() then rips the PipeWire loopback out from under
      // that still-open naudiodon stream. Confirmed empirically: without
      // this, the very next specs to touch backend audio
      // (audio-panels.spec.ts, cw-decode-panel.spec.ts) failed to see any
      // real signal. Same discipline those two specs already use for their
      // own "Stop Backend Audio" cleanup — this is the I/Q-source
      // equivalent.
      await disableSpectrumScope(page).catch(() => {});
      stopIqTonePlayer();
      // Disconnect cleanly before the Dummy rigctld process is stopped in
      // afterAll — see connect-helper.ts's disconnectFromDummy for why. Runs
      // even if an assertion above failed, so a flake here can't cascade
      // into an unexpected-drop/auto-reconnect-loop mess for whichever spec
      // runs next.
      await disconnectFromDummy(page);
    }
  });
});

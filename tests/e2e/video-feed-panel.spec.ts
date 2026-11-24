import { test, expect } from '../fixtures/test.ts';
import { AUTH_STATE_PATH } from '../../playwright.config.ts';

// Runs under the 'video-fake-device' Playwright project (see
// playwright.config.ts), which launches Chromium with a fake camera device
// (--use-fake-device-for-media-stream + --use-file-for-fake-video-capture
// pointed at tests/fixtures/fake-video.ts's generated Y4M). useVideoStream.ts
// only runs getUserMedia()/VideoEncoder when `window.electron` is truthy
// (isElectronSource) — stubbing that on one page turns it into a real
// encode source; a second, unstubbed page is a genuine WebCodecs receiver.
// No production code changes needed for either half of the round trip.
test.describe('VideoFeedPanel encode -> decode round trip via a fake camera', () => {
  test('a stubbed-Electron source streams real frames to a plain receiver', async ({ browser }) => {
    // Receiver connects first so its socket is already listening in time to
    // catch the source's very first frame (always a keyframe) — the server
    // only buffers the latest keyframe for its own bookkeeping and never
    // re-sends it to a client that joins after the fact (server/video.ts).
    const receiverContext = await browser.newContext({ storageState: AUTH_STATE_PATH, ignoreHTTPSErrors: true });
    const receiverPage = await receiverContext.newPage();
    await receiverPage.goto('/');
    const panel = receiverPage.locator(
      'xpath=//span[normalize-space(text())="Video Feed"]/ancestor::div[contains(@class,"rounded-xl")][1]',
    );
    const canvas = panel.locator('canvas').first();
    await expect(panel).toContainText('Video Feed');
    // The saved storageState (tests/.auth/state.json, from global-setup.ts)
    // carries a collapsed Video Feed panel by default — PanelChrome doesn't
    // render body content (the <video>/<canvas> pair) at all while
    // collapsed, regardless of stream status.
    const expandButton = panel.getByTitle('Expand');
    if (await expandButton.isVisible().catch(() => false)) {
      await expandButton.click();
    }

    const sourceContext = await browser.newContext({ storageState: AUTH_STATE_PATH, ignoreHTTPSErrors: true });
    const sourcePage = await sourceContext.newPage();
    await sourcePage.addInitScript(() => {
      (window as any).electron = { resizeWindow: () => {} };
    });
    await sourcePage.goto('/');

    await sourcePage.getByTitle('Video Settings').click();
    const deviceSelect = sourcePage
      .locator('label:text-is("Video Device")')
      .locator('xpath=following-sibling::select[1]');
    // Populated asynchronously by enumerateVideoDevices() (navigator.mediaDevices
    // .enumerateDevices()) — wait for the fake device's <option> to land
    // before selecting it.
    await expect(deviceSelect.locator('option')).toHaveCount(2, { timeout: 10_000 });
    await deviceSelect.selectOption({ index: 1 });
    await sourcePage
      .locator('label:text-is("Framerate")')
      .locator('xpath=following-sibling::select[1]')
      .selectOption('5');
    await sourcePage.getByRole('button', { name: 'Start Video', exact: true }).click();

    async function canvasFingerprint(): Promise<number> {
      return canvas.evaluate((el: HTMLCanvasElement) => {
        const ctx = el.getContext('2d')!;
        const { data } = ctx.getImageData(0, 0, el.width, el.height);
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i];
        return sum;
      });
    }

    await expect(canvas).toBeVisible({ timeout: 15_000 });

    // Non-zero canvas dimensions means the VideoDecoder configured and drew
    // at least one real decoded frame.
    await expect.poll(
      () => canvas.evaluate((el: HTMLCanvasElement) => el.width),
      { timeout: 15_000 },
    ).toBeGreaterThan(0);

    const first = await canvasFingerprint();
    // The fixture's luma cycles frame-to-frame (fake-video.ts) specifically
    // so a second sample proves real, continuing decode — not a single
    // static frame left on screen.
    await expect.poll(canvasFingerprint, { timeout: 15_000 }).not.toBe(first);

    await sourceContext.close();
    await receiverContext.close();
  });
});

// Regression test for bug #46: a remote-only browser session (no local
// Electron app ever opened) had no way to recover from an empty/stale
// Video Device dropdown. Root cause was twofold — see server/video.ts,
// src/hooks/useVideoStream.ts, and src/panels/VideoFeedPanel.tsx:
//   1. VideoFeedPanel's handleSettingsClick only re-emitted "get-video-devices"
//      when `variant !== "compact"` — a leftover condition from a
//      three-layout ("phone"|"compact"|"desktop") era that made sense before
//      the "desktop" variant was folded into "compact" (2026-05-01,
//      commit 86ebfad); after that merge it silently excluded the primary
//      desktop/browser layout from ever refreshing.
//   2. Even with that fixed, a remote browser has no camera of its own to
//      enumerate — only the Electron source can — so it also needs a way to
//      ask the Electron source to actually re-run enumerateDevices(),
//      not just re-fetch whatever the server has cached.
test.describe('VideoFeedPanel remote device-list refresh (bug #46)', () => {
  test('a remote browser can force the Electron source to re-enumerate cameras', async ({ browser }) => {
    const sourceContext = await browser.newContext({ storageState: AUTH_STATE_PATH, ignoreHTTPSErrors: true });
    const sourcePage = await sourceContext.newPage();
    await sourcePage.addInitScript(() => {
      (window as any).electron = { resizeWindow: () => {} };
      (window as any).__enumerateCallCount = 0;
      const original = navigator.mediaDevices.enumerateDevices.bind(navigator.mediaDevices);
      navigator.mediaDevices.enumerateDevices = (...args: []) => {
        (window as any).__enumerateCallCount++;
        return original(...args);
      };
    });
    await sourcePage.goto('/');

    // Let the mount-time auto-enumerate (unconditional, unaffected by this
    // fix) complete before taking the baseline count.
    await expect.poll(
      () => sourcePage.evaluate(() => (window as any).__enumerateCallCount),
      { timeout: 10_000 },
    ).toBeGreaterThan(0);
    const initialCount = await sourcePage.evaluate(() => (window as any).__enumerateCallCount);

    // Plain remote browser — default viewport (1280x720 for the
    // 'video-fake-device' project) renders CompactLayout, exactly the
    // "compact" desktop/browser view bug #46 was filed against.
    const receiverContext = await browser.newContext({ storageState: AUTH_STATE_PATH, ignoreHTTPSErrors: true });
    const receiverPage = await receiverContext.newPage();
    await receiverPage.goto('/');
    const panel = receiverPage.locator(
      'xpath=//span[normalize-space(text())="Video Feed"]/ancestor::div[contains(@class,"rounded-xl")][1]',
    );
    const expandButton = panel.getByTitle('Expand');
    if (await expandButton.isVisible().catch(() => false)) {
      await expandButton.click();
    }

    await receiverPage.getByTitle('Video Settings').click();

    // The click should round-trip through the server
    // (request-video-devices-refresh -> video-devices-refresh-requested) and
    // cause the Electron source to call enumerateDevices() again.
    await expect.poll(
      () => sourcePage.evaluate(() => (window as any).__enumerateCallCount),
      { timeout: 10_000 },
    ).toBeGreaterThan(initialCount);

    // And the receiver's own dropdown should end up populated with a real
    // device, not just the placeholder option.
    const deviceSelect = receiverPage
      .locator('label:text-is("Video Device")')
      .locator('xpath=following-sibling::select[1]');
    await expect.poll(
      () => deviceSelect.locator('option').count(),
      { timeout: 10_000 },
    ).toBeGreaterThan(1);

    await sourceContext.close();
    await receiverContext.close();
  });
});

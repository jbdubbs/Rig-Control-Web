import path from 'path';
import { fileURLToPath } from 'url';
import { test, expect, type Page } from '../fixtures/test.ts';
import { startDummyRigctld, type DummyRigctld } from '../fixtures/rigctld-dummy.ts';
import { startSwrProxy, type SwrProxy } from '../fixtures/swr-proxy.ts';
import { connectToDummy, disconnectFromDummy } from './connect-helper.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');

// Issue #128. Hamlib's Dummy rig can't report a real SWR, so a proxy (tests/fixtures/swr-proxy.ts)
// sits in front of the real Dummy rigctld and answers `l SWR` itself, and fakes the carrier an ATU
// tune produces. Everything else, including PTT, goes through real Hamlib.
test.describe('SWR protection (#128)', () => {
  // Real waits on the rig's PTT/trip round trips; the default 30 s is too tight.
  test.setTimeout(90_000);
  let dummy: DummyRigctld;
  let proxy: SwrProxy;

  test.beforeAll(async () => {
    dummy = await startDummyRigctld(REPO_ROOT);
    proxy = await startSwrProxy(dummy.port, { tuneCarrierMs: 5000 });
  });

  test.afterAll(async () => {
    await proxy.stop();
    await dummy.stop();
  });

  // The server process (and its settings) is shared by every spec, so always leave protection off.
  async function setProtection(page: Page, enabled: boolean, threshold?: string) {
    await page.getByTestId('swr-protection-button').click();
    const toggle = page.getByTestId('swr-protection-enabled');
    if ((await toggle.isChecked()) !== enabled) await toggle.click();
    if (threshold !== undefined) {
      const input = page.getByTestId('swr-protection-threshold');
      await input.fill(threshold);
      await input.press('Enter');
    }
    await page.keyboard.press('Escape');
  }

  const proxied = { port: 0 } as unknown as DummyRigctld;

  test('settings save, persist across reload, and the trip latches until cleared', async ({ page }) => {
    proxied.port = proxy.port;
    proxy.setSwr(1.2);
    await page.goto('/');
    await connectToDummy(page, proxied);
    const ptt = page.getByTestId('controls-ptt-button');
    const banner = page.getByTestId('swr-trip-banner');

    try {
      await setProtection(page, true, '3.0');

      // Persisted server-side: still on, same threshold, after a full reload.
      await page.reload();
      await expect(page.getByTestId('swr-protection-button')).toContainText('SWR 3.0');
      await page.getByTestId('swr-protection-button').click();
      await expect(page.getByTestId('swr-protection-enabled')).toBeChecked();
      await expect(page.getByTestId('swr-protection-threshold')).toHaveValue('3.0');
      await page.keyboard.press('Escape');

      // Normal TX at a good SWR is untouched.
      await ptt.click();
      await expect(ptt).toHaveClass(/border-red-500/, { timeout: 10_000 });
      await page.waitForTimeout(1500);
      await expect(banner).toBeHidden();
      await ptt.click();
      await expect(ptt).not.toHaveClass(/border-red-500/, { timeout: 10_000 });

      // High SWR: TX is cut and the reading that caused it is shown.
      proxy.setSwr(5);
      await ptt.click();
      await expect(banner).toBeVisible({ timeout: 10_000 });
      await expect(banner).toContainText('5.00:1');
      await expect(banner).toContainText('3.0:1');
      await expect(ptt).not.toHaveClass(/border-red-500/, { timeout: 10_000 });

      // Latched: keying again is refused even though SWR is fine now.
      proxy.setSwr(1.2);
      await ptt.click();
      await page.waitForTimeout(1500);
      await expect(ptt).not.toHaveClass(/border-red-500/);
      await expect(banner).toBeVisible();

      // Clear, then TX works again.
      await page.getByTestId('swr-trip-clear').click();
      await expect(banner).toBeHidden({ timeout: 5_000 });
      await ptt.click();
      await expect(ptt).toHaveClass(/border-red-500/, { timeout: 10_000 });
      await ptt.click();
      await expect(ptt).not.toHaveClass(/border-red-500/, { timeout: 10_000 });
    } finally {
      proxy.setSwr(1.0);
      if (await banner.isVisible()) await page.getByTestId('swr-trip-clear').click();
      await setProtection(page, false);
    }
    await disconnectFromDummy(page);
  });

  test('an app-initiated tune cycle is not cut off even at high SWR, but normal TX still is', async ({ page }) => {
    proxied.port = proxy.port;
    proxy.setSwr(5);
    await page.goto('/');
    await connectToDummy(page, proxied);
    const ptt = page.getByTestId('controls-ptt-button');
    const banner = page.getByTestId('swr-trip-banner');

    try {
      await setProtection(page, true, '3.0');

      // The proxy keys the rig for 5 s, as an ATU does; SWR reads 5:1 throughout.
      await page.getByTestId('controls-tune-button').click();
      await expect(ptt).toHaveClass(/border-red-500/, { timeout: 4_000 });
      await page.waitForTimeout(3_000);
      await expect(banner).toBeHidden();
      // The tune ends on its own and the rig unkeys.
      await expect(ptt).not.toHaveClass(/border-red-500/, { timeout: 10_000 });
      await expect(banner).toBeHidden();

      // Protection is back in force once the tune is over.
      await ptt.click();
      await expect(banner).toBeVisible({ timeout: 10_000 });
    } finally {
      proxy.setSwr(1.0);
      if (await banner.isVisible()) await page.getByTestId('swr-trip-clear').click();
      await setProtection(page, false);
    }
    await disconnectFromDummy(page);
  });
});

import path from 'path';
import { fileURLToPath } from 'url';
import { test, expect } from '../fixtures/test.ts';
import { startDummyRigctld, type DummyRigctld } from '../fixtures/rigctld-dummy.ts';
import { connectToDummy, disconnectFromDummy } from './connect-helper.ts';
import { routeSpots } from '../fixtures/spot-fixtures.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');

// SpotComboPanel ("spots_combo") is in DEFAULT_COMPACT_LAYOUT (useLayoutConfig.ts)
// and POTA/SOTA/WWFF fetch-enable is derived purely from layout membership
// (App.tsx's potaEnabled/sotaEnabled/wwffEnabled), not a settings toggle — all
// three fetches fire automatically on page load with no seeding needed.

test.describe('SpotComboPanel with mocked POTA/SOTA/WWFF feeds', () => {
  test('defaults to the POTA tab and renders the fixture spot', async ({ page }) => {
    await routeSpots(page);
    await page.goto('/');

    await expect(page.getByRole('button', { name: 'POTA', exact: true })).toBeVisible();
    const row = page.locator('tr', { hasText: 'W1ABC' });
    await expect(row).toContainText('14.074');
    await expect(row).toContainText('FT8');
    await expect(row).toContainText('US-CT');
    await expect(row).toContainText('K-1234');
  });

  test('switches to the SOTA tab and renders the fixture spot', async ({ page }) => {
    await routeSpots(page);
    await page.goto('/');

    await page.getByRole('button', { name: 'SOTA', exact: true }).click();
    const row = page.locator('tr', { hasText: 'W2XYZ' });
    await expect(row).toContainText('14.285');
    await expect(row).toContainText('SSB');
    await expect(row).toContainText('W2/NS-001');
  });

  test('switches to the WWFF tab and renders the fixture spot', async ({ page }) => {
    await routeSpots(page);
    await page.goto('/');

    await page.getByRole('button', { name: 'WWFF', exact: true }).click();
    const row = page.locator('tr', { hasText: 'W3DEF' });
    await expect(row).toContainText('5.357');
    await expect(row).toContainText('FT8');
    await expect(row).toContainText('KFF-0001');
  });

  test('shows the empty state when a feed returns no spots', async ({ page }) => {
    await routeSpots(page, { pota: [] });
    await page.goto('/');

    await expect(page.getByText(/No POTA spots in the last \d+ min/)).toBeVisible();
  });

  test('tune-to-spot round-trips a real frequency change against Dummy rigctld', async ({ page }) => {
    const dummy: DummyRigctld = await startDummyRigctld(REPO_ROOT);
    try {
      await routeSpots(page);
      await page.goto('/');
      await connectToDummy(page, dummy);

      await page.getByRole('button', { name: '14.074', exact: true }).click();
      // Round trip: tune-to-spot -> "F 14074000" -> rigctld -> Dummy -> "f"
      // re-read -> rig-status -> VFO frequency input re-renders.
      const freqInput = page.getByTitle('Click to edit frequency');
      await expect(freqInput).toHaveValue('14.074000', { timeout: 10_000 });

      await disconnectFromDummy(page);
    } finally {
      await dummy.stop();
    }
  });
});

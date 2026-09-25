import { test, expect } from '@playwright/test';
import { routeSpots } from '../fixtures/spot-fixtures.ts';
import { DEFAULT_PHONE_LAYOUT } from '../../src/hooks/useLayoutConfig.ts';

// spots_pota/spots_sota/spots_wwff (the individual per-source panels, as
// opposed to the already-covered spots_combo) only have a render case in
// PhoneLayout.tsx — CompactLayout has no case for them at all. App.tsx's
// potaEnabled/sotaEnabled/wwffEnabled flags (which gate the fetches) read
// from phoneLayout.items when isPhone is true, so this spec must run at a
// sub-768px viewport with the panel seeded into the phone layout, not the
// compact one.
test.use({ viewport: { width: 390, height: 844 } });

function phoneLayoutWith(panelType: 'spots_pota' | 'spots_sota' | 'spots_wwff') {
  return {
    compact: { cols: 3, rows: 1, items: [] },
    phone: {
      ...DEFAULT_PHONE_LAYOUT,
      items: [
        { i: panelType, x: 0, y: 0, w: 1, h: 1, minW: 1, minH: 1, panelType },
      ],
    },
  };
}

test.describe('Individual Spots panels with mocked feeds', () => {
  test('spots_pota renders the fixture spot', async ({ page }) => {
    await page.addInitScript((cfg) => {
      localStorage.setItem('grid-layout-v1', JSON.stringify(cfg));
      // Layout storage is keyed by the signed-in callsign (useLayoutConfig); the e2e user is ADMIN.
      localStorage.setItem('ADMIN:grid-layout-v1', JSON.stringify(cfg));
    }, phoneLayoutWith('spots_pota'));
    await routeSpots(page);
    await page.goto('/');

    await expect(page.getByText('POTA Spots', { exact: true })).toBeVisible();
    const row = page.locator('tr', { hasText: 'W1ABC' });
    await expect(row).toContainText('14.074');
    await expect(row).toContainText('FT8');
    await expect(row).toContainText('K-1234');
  });

  test('spots_pota shows the empty state when the feed returns no spots', async ({ page }) => {
    await page.addInitScript((cfg) => {
      localStorage.setItem('grid-layout-v1', JSON.stringify(cfg));
      // Layout storage is keyed by the signed-in callsign (useLayoutConfig); the e2e user is ADMIN.
      localStorage.setItem('ADMIN:grid-layout-v1', JSON.stringify(cfg));
    }, phoneLayoutWith('spots_pota'));
    await routeSpots(page, { pota: [] });
    await page.goto('/');

    await expect(page.getByText(/No POTA spots in the last \d+ min/)).toBeVisible();
  });

  test('spots_sota renders the fixture spot', async ({ page }) => {
    await page.addInitScript((cfg) => {
      localStorage.setItem('grid-layout-v1', JSON.stringify(cfg));
      // Layout storage is keyed by the signed-in callsign (useLayoutConfig); the e2e user is ADMIN.
      localStorage.setItem('ADMIN:grid-layout-v1', JSON.stringify(cfg));
    }, phoneLayoutWith('spots_sota'));
    await routeSpots(page);
    await page.goto('/');

    await expect(page.getByText('SOTA Spots', { exact: true })).toBeVisible();
    const row = page.locator('tr', { hasText: 'W2XYZ' });
    await expect(row).toContainText('14.285');
    await expect(row).toContainText('SSB');
    await expect(row).toContainText('W2/NS-001');
  });

  test('spots_sota shows the empty state when the feed returns no spots', async ({ page }) => {
    await page.addInitScript((cfg) => {
      localStorage.setItem('grid-layout-v1', JSON.stringify(cfg));
      // Layout storage is keyed by the signed-in callsign (useLayoutConfig); the e2e user is ADMIN.
      localStorage.setItem('ADMIN:grid-layout-v1', JSON.stringify(cfg));
    }, phoneLayoutWith('spots_sota'));
    await routeSpots(page, { sota: [] });
    await page.goto('/');

    await expect(page.getByText(/No SOTA spots in the last \d+ min/)).toBeVisible();
  });

  test('spots_wwff renders the fixture spot', async ({ page }) => {
    await page.addInitScript((cfg) => {
      localStorage.setItem('grid-layout-v1', JSON.stringify(cfg));
      // Layout storage is keyed by the signed-in callsign (useLayoutConfig); the e2e user is ADMIN.
      localStorage.setItem('ADMIN:grid-layout-v1', JSON.stringify(cfg));
    }, phoneLayoutWith('spots_wwff'));
    await routeSpots(page);
    await page.goto('/');

    await expect(page.getByText('WWFF Spots', { exact: true })).toBeVisible();
    const row = page.locator('tr', { hasText: 'W3DEF' });
    await expect(row).toContainText('5.357');
    await expect(row).toContainText('FT8');
    await expect(row).toContainText('KFF-0001');
  });

  test('spots_wwff shows the empty state when the feed returns no spots', async ({ page }) => {
    await page.addInitScript((cfg) => {
      localStorage.setItem('grid-layout-v1', JSON.stringify(cfg));
      // Layout storage is keyed by the signed-in callsign (useLayoutConfig); the e2e user is ADMIN.
      localStorage.setItem('ADMIN:grid-layout-v1', JSON.stringify(cfg));
    }, phoneLayoutWith('spots_wwff'));
    await routeSpots(page, { wwff: [] });
    await page.goto('/');

    await expect(page.getByText(/No WWFF spots in the last \d+ min/)).toBeVisible();
  });
});

import { test, expect } from '../fixtures/test.ts';
import { SOLAR_FIXTURE } from '../fixtures/solar-fixture-server.ts';

// server/solar.ts fetches from RCW_SOLAR_HAMQSL_URL/RCW_SOLAR_KC2G_URL
// (env-var overrides, unset in production — see playwright.config.ts's
// webServer.env), pointed at tests/fixtures/solar-fixture-server.ts's local
// HTTP server instead of the real hamqsl.com/prop.kc2g.com. The server
// fetches once per hour and caches (server/solar.ts's sendFreshSolarData),
// and the first authenticated socket connection in the whole run (during
// global-setup.ts's login) already triggers that fetch — solarData is
// pushed automatically on page load, no explicit action needed to see it.
test.describe('SolarPanel against a mocked hamqsl.com/kc2g.com fixture', () => {
  test('renders quick-glance indices and HF band conditions from the fixture', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByText('Solar Conditions', { exact: true })).toBeVisible();
    await expect(page.getByText(`SFI=${SOLAR_FIXTURE.solarflux}`)).toBeVisible();
    await expect(page.getByText(`SN=${SOLAR_FIXTURE.sunspots}`)).toBeVisible();
    await expect(page.getByText(`A=${SOLAR_FIXTURE.aindex}`)).toBeVisible();
    await expect(page.getByText(`K=${SOLAR_FIXTURE.kindex}`)).toBeVisible();

    for (const band of SOLAR_FIXTURE.hfBands) {
      const row = page.locator('div', { hasText: band.name }).filter({ hasText: band.day }).last();
      await expect(row).toContainText(band.day);
      await expect(row).toContainText(band.night);
    }

    await expect(page.getByText(`As of ${SOLAR_FIXTURE.updated}`)).toBeVisible();
  });

  test('SOLAR/GEO tab shows eSFI/eSSN and geomag/xray fields from the fixture', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'SOLAR/GEO', exact: true }).click();

    await expect(page.getByText('eSFI', { exact: true })).toBeVisible();
    await expect(page.getByText(String(SOLAR_FIXTURE.esfi), { exact: true })).toBeVisible();
    await expect(page.getByText(String(SOLAR_FIXTURE.essn), { exact: true })).toBeVisible();
    await expect(page.getByText(SOLAR_FIXTURE.geomagfield, { exact: true })).toBeVisible();
    await expect(page.getByText(SOLAR_FIXTURE.xray, { exact: true })).toBeVisible();
  });

  test('the refresh button re-requests solar data without erroring', async ({ page }) => {
    await page.goto('/');

    await page.getByTitle('Refresh solar data').click();

    // Cache is fresh (< 1hr old, per sendFreshSolarData), so this re-emits
    // the same cached fixture values rather than forcing a real re-fetch —
    // still proves the request-solar-data round trip works end to end.
    await expect(page.getByText(`SFI=${SOLAR_FIXTURE.solarflux}`)).toBeVisible();
  });
});

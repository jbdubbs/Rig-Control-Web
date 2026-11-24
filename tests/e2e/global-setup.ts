import { chromium } from '@playwright/test';
import { AUTH_STATE_PATH, BASE_URL } from '../../playwright.config.ts';
import { startSolarFixtureServer } from '../fixtures/solar-fixture-server.ts';
import { startAudioLoopback } from '../fixtures/audio-loopback.ts';
import { routeSpots } from '../fixtures/spot-fixtures.ts';

/**
 * Logs in once as the freshly-seeded default ADMIN user (see server/auth.ts
 * — a fresh RCW_DATA_DIR has no users.json, so ADMIN/admin is created with
 * mustChangePassword: true), completes the forced password change, and
 * saves the resulting authenticated storageState for every test to reuse.
 */
export default async function globalSetup() {
  // Must be listening before the login below — server/solar.ts fetches
  // solar data (from RCW_SOLAR_HAMQSL_URL/RCW_SOLAR_KC2G_URL, pointed at
  // this fixture server via playwright.config.ts's webServer.env) as soon
  // as the first socket authenticates, and caches it for an hour — every
  // other spec in the run reuses that same cached fetch.
  await startSolarFixtureServer();

  // Gives server/audio.ts's naudiodon a real device to open — see
  // tests/fixtures/audio-loopback.ts. Only needs to exist by the time a
  // spec calls get-audio-devices, not before the app server itself boots
  // (initAudioEngine()'s naudiodon import only needs libpulse.so.0
  // resolvable, not any particular device to exist yet).
  await startAudioLoopback();

  const browser = await chromium.launch();
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  // Spot feeds are mocked everywhere except the opt-in live pre-release check (see
  // tests/fixtures/test.ts). Setup must never depend on them: a pending third-party
  // request here stalls the `networkidle` wait below.
  await routeSpots(context);
  const page = await context.newPage();

  await page.goto(BASE_URL);

  await page.getByPlaceholder('W1ABC').fill('ADMIN');
  await page.locator('input[type="password"]').fill('admin');
  await page.getByRole('button', { name: /sign in/i }).click();

  // Freshly-seeded ADMIN account is forced through a password change —
  // wait for that screen's own button before touching its inputs, so we
  // don't race the still-visible login screen's password field.
  const saveButton = page.getByRole('button', { name: /save password/i });
  await saveButton.waitFor({ state: 'visible' });
  const passwordInputs = page.locator('input[type="password"]');
  await passwordInputs.nth(0).fill('admin');
  await passwordInputs.nth(1).fill('TestHarness123!');
  await passwordInputs.nth(2).fill('TestHarness123!');
  await saveButton.click();

  // Main app shell has loaded once the login/password-change screens are gone.
  await page.getByPlaceholder('W1ABC').waitFor({ state: 'detached' }).catch(() => {});
  await page.waitForLoadState('networkidle');

  await context.storageState({ path: AUTH_STATE_PATH });
  await browser.close();
}

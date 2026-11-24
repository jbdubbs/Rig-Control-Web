import { test, expect, type Browser, type Page } from '../fixtures/test.ts';
import { AUTH_STATE_PATH, BASE_URL } from '../../playwright.config.ts';

// Covers ground CLAUDE.md's backlog table flagged as untested: admin user
// CRUD, auth:kicked (via admin:force-logout), and token refresh on reload.
// The forced-password-change screen itself is also exercised implicitly by
// global-setup.ts for every other spec, but only as fixture setup — here
// it's asserted directly.
//
// IMPORTANT: playwright.config.ts runs workers:1 against one shared server
// process, and every other spec's storageState depends on the seeded ADMIN
// account staying valid. This spec must never call admin:factory-reset and
// must never modify/delete the ADMIN account itself — all CRUD here targets
// a throwaway scratch user, cleaned up in afterAll.

const SCRATCH_CALLSIGN = 'E2ETEST1';
const SCRATCH_PASSWORD = 'ScratchPass123!';
const SCRATCH_RESET_PASSWORD = 'ScratchReset456!';
const SCRATCH_NEW_PASSWORD = 'ScratchChosen789!';

async function openAdminTab(page: Page) {
  await page.getByTitle('Rigctld Settings').click();
  await page.getByRole('button', { name: 'admin', exact: true }).click();
}

function usersSection(page: Page) {
  return page.getByRole('heading', { name: 'User Management', exact: true }).locator('xpath=..');
}

function sessionsSection(page: Page) {
  return page.getByRole('heading', { name: 'Active Sessions', exact: true }).locator('xpath=..');
}

// Row DOM shape (AdminTab.tsx): <div row><div info><span>{callsign}</span>...</div><div buttons>...</div></div>
// From the callsign span, two ancestor hops reaches the row div containing
// both the info and the action buttons.
function userRow(page: Page, callsign: string) {
  return usersSection(page).getByText(callsign, { exact: true }).locator('xpath=../..');
}

function sessionRow(page: Page, callsign: string) {
  return sessionsSection(page).getByText(callsign, { exact: true }).locator('xpath=../..');
}

async function loginAs(page: Page, callsign: string, password: string) {
  await page.goto(BASE_URL);
  await page.getByPlaceholder('W1ABC').fill(callsign);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();
}

// playwright.config.ts's project-level `use.storageState` (AUTH_STATE_PATH)
// is applied as the DEFAULT for every browser.newContext() call made inside
// a test, not just the auto-created page/context fixtures — so a plain
// `browser.newContext({ ignoreHTTPSErrors: true })` silently inherits
// ADMIN's session. Explicitly clearing storageState is required to get a
// truly logged-out context.
async function newAnonymousContext(browser: Browser) {
  return browser.newContext({ ignoreHTTPSErrors: true, storageState: { cookies: [], origins: [] } });
}

test.describe.serial('Admin / Auth e2e flows', () => {
  test.afterAll(async ({ browser }) => {
    // Best-effort cleanup in case an earlier test in this file failed before
    // its own delete step ran — leaving the scratch user behind would break
    // re-runs ("Callsign already exists").
    const context = await browser.newContext({ storageState: AUTH_STATE_PATH, ignoreHTTPSErrors: true });
    const page = await context.newPage();
    page.on('dialog', (d) => d.accept());
    await page.goto(BASE_URL);
    await openAdminTab(page);
    const row = userRow(page, SCRATCH_CALLSIGN);
    if (await row.isVisible().catch(() => false)) {
      await row.getByRole('button', { name: 'Del', exact: true }).click();
    }
    await context.close();
  });

  test('admin creates a user and it appears in the users list', async ({ page }) => {
    await page.goto('/');
    await openAdminTab(page);

    await page.getByRole('button', { name: '+ Add User' }).click();
    await page.getByPlaceholder('Callsign').fill(SCRATCH_CALLSIGN);
    await page.getByPlaceholder('Password (min 8 chars)').fill(SCRATCH_PASSWORD);
    await page.getByRole('button', { name: 'Create', exact: true }).click();

    const row = userRow(page, SCRATCH_CALLSIGN);
    await expect(row).toBeVisible();
    await expect(row).toContainText('regular');
  });

  test('admin toggles the scratch user role and back', async ({ page }) => {
    await page.goto('/');
    await openAdminTab(page);

    const row = userRow(page, SCRATCH_CALLSIGN);
    await expect(row).toContainText('regular');
    await row.getByRole('button', { name: 'Role', exact: true }).click();
    await expect(row).toContainText('admin');
    await row.getByRole('button', { name: 'Role', exact: true }).click();
    await expect(row).toContainText('regular');
  });

  test("resetting the scratch user's password forces a password change on next login", async ({ page, browser }) => {
    await page.goto('/');
    await openAdminTab(page);

    const row = userRow(page, SCRATCH_CALLSIGN);
    await row.getByRole('button', { name: 'Reset PW', exact: true }).click();
    await page.getByPlaceholder('New password (min 8 chars)').fill(SCRATCH_RESET_PASSWORD);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(row).toContainText('pw reset');

    // The default `page` fixture carries ADMIN's token in localStorage
    // (from AUTH_STATE_PATH) and would auto-authenticate as ADMIN on load
    // instead of showing the login screen — log in as the scratch user from
    // a fresh, storageState-free context instead.
    const scratchContext = await newAnonymousContext(browser);
    const scratchPage = await scratchContext.newPage();
    await loginAs(scratchPage, SCRATCH_CALLSIGN, SCRATCH_RESET_PASSWORD);

    const saveButton = scratchPage.getByRole('button', { name: /save password/i });
    await expect(saveButton).toBeVisible();
    const pwInputs = scratchPage.locator('input[type="password"]');
    await pwInputs.nth(0).fill(SCRATCH_RESET_PASSWORD);
    await pwInputs.nth(1).fill(SCRATCH_NEW_PASSWORD);
    await pwInputs.nth(2).fill(SCRATCH_NEW_PASSWORD);
    await saveButton.click();

    // App shell loaded — login screen is gone.
    await expect(scratchPage.getByPlaceholder('W1ABC')).toHaveCount(0);
    await scratchContext.close();
  });

  test('admin force-logout kicks a live scratch-user session (auth:kicked)', async ({ page, browser }) => {
    const scratchContext = await newAnonymousContext(browser);
    const scratchPage = await scratchContext.newPage();
    await loginAs(scratchPage, SCRATCH_CALLSIGN, SCRATCH_NEW_PASSWORD);
    await expect(scratchPage.getByPlaceholder('W1ABC')).toHaveCount(0);

    await page.goto('/');
    await openAdminTab(page);
    const row = sessionRow(page, SCRATCH_CALLSIGN);
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: 'Kick', exact: true }).click();

    await expect(scratchPage.getByPlaceholder('W1ABC')).toBeVisible({ timeout: 10_000 });
    await scratchContext.close();
  });

  test('single-session limit signs out the older client but not other tabs of the same browser (#130)', async ({ page, browser }) => {
    await page.goto('/');
    await openAdminTab(page);
    const limitBox = page.getByRole('checkbox', { name: /one active session/i });
    // Controlled by server state, so it flips after the round trip; .check() would fail its immediate state assertion.
    await limitBox.click();
    await expect(limitBox).toBeChecked();

    const contextA = await newAnonymousContext(browser);
    const contextB = await newAnonymousContext(browser);
    try {
      const pageA = await contextA.newPage();
      await loginAs(pageA, SCRATCH_CALLSIGN, SCRATCH_NEW_PASSWORD);
      await expect(pageA.getByPlaceholder('W1ABC')).toHaveCount(0);

      // A second tab in the same browser shares client-id, so it is the same session.
      const pageA2 = await contextA.newPage();
      await pageA2.goto(BASE_URL);
      await expect(pageA2.getByPlaceholder('W1ABC')).toHaveCount(0);
      await expect(pageA.getByPlaceholder('W1ABC')).toHaveCount(0);

      // A different client logging in with the password displaces client A (both its tabs).
      const pageB = await contextB.newPage();
      await loginAs(pageB, SCRATCH_CALLSIGN, SCRATCH_NEW_PASSWORD);
      await expect(pageB.getByPlaceholder('W1ABC')).toHaveCount(0);

      await expect(pageA.getByPlaceholder('W1ABC')).toBeVisible();
      await expect(pageA.getByText(/another device/)).toBeVisible();
      await expect(pageA2.getByPlaceholder('W1ABC')).toBeVisible();

      // Client A's stale token must not bounce B back out on reload.
      await pageA.reload();
      await expect(pageA.getByPlaceholder('W1ABC')).toBeVisible();
      await expect(pageB.getByPlaceholder('W1ABC')).toHaveCount(0);
    } finally {
      await contextA.close();
      await contextB.close();
      await limitBox.click();
      await expect(limitBox).not.toBeChecked();
    }
  });

  test('admin deletes the scratch user and it disappears from the list', async ({ page }) => {
    page.on('dialog', (d) => d.accept());
    await page.goto('/');
    await openAdminTab(page);

    const row = userRow(page, SCRATCH_CALLSIGN);
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: 'Del', exact: true }).click();
    await expect(userRow(page, SCRATCH_CALLSIGN)).toHaveCount(0);
  });

  test('reloading an authenticated session survives via token refresh', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTitle('Rigctld Settings')).toBeVisible();

    await page.reload();

    // auth:token-refreshed (server.ts, on every socket connection) should
    // land the reload straight back in the authenticated app shell, not
    // bounce through the login screen.
    await expect(page.getByPlaceholder('W1ABC')).toHaveCount(0);
    await expect(page.getByTitle('Rigctld Settings')).toBeVisible();
  });
});

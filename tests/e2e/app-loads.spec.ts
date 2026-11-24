import { test, expect } from '../fixtures/test.ts';

test('loads the authenticated app shell', async ({ page }) => {
  await page.goto('/');
  // Login screen should not appear — storageState from global-setup should
  // already carry an authenticated session.
  await expect(page.getByPlaceholder('W1ABC')).toHaveCount(0);
  // A real panel-chrome control from the logged-in app shell should render.
  await expect(page.getByTitle('Rigctld Settings')).toBeVisible();
});

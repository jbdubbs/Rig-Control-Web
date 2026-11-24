import { test, expect } from '../fixtures/test.ts';

test.describe('Light/dark theme toggle', () => {
  test('defaults to dark, toggles to light, and persists across reload', async ({ page }) => {
    await page.goto('/');
    const html = page.locator('html');
    await expect(html).toHaveAttribute('data-theme', 'dark');
    const darkBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);

    await page.getByTitle('Switch to light theme').first().click();
    await expect(html).toHaveAttribute('data-theme', 'light');
    const lightBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(lightBg).not.toBe(darkBg);

    await page.reload();
    await expect(html).toHaveAttribute('data-theme', 'light');

    // Restore the default so later specs (shared browser storage state) see dark.
    await page.getByTitle('Switch to dark theme').first().click();
    await expect(html).toHaveAttribute('data-theme', 'dark');
  });
});

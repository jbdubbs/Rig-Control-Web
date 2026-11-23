import { test, expect } from '@playwright/test';

test.describe('UI scale (Display tab)', () => {
  test('scales the page, persists across reload, and resets', async ({ page }) => {
    await page.goto('/');
    await page.getByTitle('Rigctld Settings').click();
    await page.getByRole('button', { name: 'display', exact: true }).click();

    const value = page.getByTestId('ui-scale-value');
    await expect(value).toHaveText('100%');

    await page.getByRole('button', { name: 'Increase UI scale' }).click();
    await page.getByRole('button', { name: 'Increase UI scale' }).click();
    await expect(value).toHaveText('150%');
    expect(await page.evaluate(() => document.documentElement.style.zoom)).toBe('1.5');
    expect(await page.evaluate(() => localStorage.getItem('ui-scale'))).toBe('1.5');

    await page.reload();
    expect(await page.evaluate(() => document.documentElement.style.zoom)).toBe('1.5');

    await page.getByTitle('Rigctld Settings').click();
    await page.getByRole('button', { name: 'display', exact: true }).click();
    await page.getByRole('button', { name: 'Reset UI scale' }).click();
    await expect(value).toHaveText('100%');
    expect(await page.evaluate(() => document.documentElement.style.zoom)).toBe('');
  });

  test('stays in the Compact layout when scaled up', async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 800 });
    await page.addInitScript(() => localStorage.setItem('ui-scale', '2'));
    await page.goto('/');
    // Compact header shows the inline Connect icon; the Phone layout hides it in the hamburger menu.
    await expect(page.getByTitle('Rigctld Settings')).toBeVisible();
    await expect(page.getByTitle('Menu')).toHaveCount(0);
    await page.evaluate(() => localStorage.removeItem('ui-scale'));
  });
});

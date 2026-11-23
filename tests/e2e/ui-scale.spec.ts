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

  test('switches to the Phone layout when scaling leaves under 768px of effective width', async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 800 });
    // Seed only when absent: init scripts re-run on reload and would clobber the later value.
    await page.addInitScript(() => { if (!localStorage.getItem('ui-scale')) localStorage.setItem('ui-scale', '1.25'); }); // 800px effective
    await page.goto('/');
    await expect(page.getByTitle('Rigctld Settings')).toBeVisible();
    await expect(page.getByTitle('Menu')).toHaveCount(0);

    await page.evaluate(() => localStorage.setItem('ui-scale', '2')); // 500px effective
    await page.reload();
    await expect(page.getByTitle('Menu').first()).toBeVisible();

    await page.evaluate(() => localStorage.removeItem('ui-scale'));
  });
});

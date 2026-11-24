import { test, expect } from '../fixtures/test.ts';

test.describe('UI scale', () => {
  test('header zoom button opens a 50-200% slider that scales the page, persists, and resets', async ({ page }) => {
    // 1600px stays >= 768px effective even at 200%, so the Compact header (and its popover) remains.
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.goto('/');
    const zoom = () => page.evaluate(() => document.documentElement.style.zoom);
    const stored = () => page.evaluate(() => localStorage.getItem('ui-scale'));

    await page.getByRole('button', { name: 'UI scale' }).click();
    const slider = page.getByRole('slider', { name: 'UI scale' });
    await expect(slider).toHaveAttribute('min', '50');
    await expect(slider).toHaveAttribute('max', '200');
    await expect(slider).toHaveAttribute('step', '25');
    await expect(page.getByTestId('ui-scale-value')).toHaveText('100%');
    await expect(page.getByRole('button', { name: 'Reset UI scale' })).toBeDisabled();

    await slider.fill('150');
    await expect(page.getByTestId('ui-scale-value')).toHaveText('150%');
    expect(await zoom()).toBe('1.5');
    expect(await stored()).toBe('1.5');

    await page.reload();
    expect(await zoom()).toBe('1.5');

    // Popover closes on Escape and on an outside click.
    await page.getByRole('button', { name: 'UI scale' }).click();
    await expect(page.getByTestId('ui-scale-popover')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('ui-scale-popover')).toHaveCount(0);

    await page.getByRole('button', { name: 'UI scale' }).click();
    await page.getByRole('button', { name: 'Reset UI scale' }).click();
    await expect(page.getByTestId('ui-scale-value')).toHaveText('100%');
    expect(await zoom()).toBe('');
    expect(await stored()).toBe('1');

    await slider.fill('50');
    expect(await zoom()).toBe('0.5');
    await slider.fill('200');
    expect(await zoom()).toBe('2');
    await page.getByRole('button', { name: 'Reset UI scale' }).click();
    expect(await zoom()).toBe('');
  });

  test('clamps an out-of-range stored scale from the old 75-300% range', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('ui-scale', '3'));
    await page.goto('/');
    expect(await page.evaluate(() => document.documentElement.style.zoom)).toBe('2');
    await page.evaluate(() => localStorage.removeItem('ui-scale'));
  });

  test('no longer has a Display tab in General Settings', async ({ page }) => {
    await page.goto('/');
    await page.getByTitle('Rigctld Settings').click();
    await expect(page.getByRole('button', { name: 'cw', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'display', exact: true })).toHaveCount(0);
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

  test('phone hamburger menu has a UI Scale stepper that stays open while stepping', async ({ page }) => {
    // 320px stays < 768px effective across the whole 50-200% range (at 50% a 390px viewport
    // would have 780px and flip to the Compact layout).
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto('/');
    await page.getByTitle('Menu').first().click();

    const value = page.getByTestId('ui-scale-value');
    await expect(value).toHaveText('100%');
    await page.getByRole('button', { name: 'Increase UI scale' }).click();
    await expect(value).toHaveText('125%'); // menu still open
    expect(await page.evaluate(() => document.documentElement.style.zoom)).toBe('1.25');

    await page.getByRole('button', { name: 'Reset UI scale' }).click();
    await expect(value).toHaveText('100%');
    expect(await page.evaluate(() => document.documentElement.style.zoom)).toBe('');

    // Same 50-200% range as the compact slider.
    for (let i = 0; i < 2; i++) await page.getByRole('button', { name: 'Decrease UI scale' }).click();
    await expect(value).toHaveText('50%');
    await expect(page.getByRole('button', { name: 'Decrease UI scale' })).toBeDisabled();
    await page.getByRole('button', { name: 'Reset UI scale' }).click();
    for (let i = 0; i < 4; i++) await page.getByRole('button', { name: 'Increase UI scale' }).click();
    await expect(value).toHaveText('200%');
    await expect(page.getByRole('button', { name: 'Increase UI scale' })).toBeDisabled();
    await page.getByRole('button', { name: 'Reset UI scale' }).click();
    await expect(value).toHaveText('100%');
  });
});

import path from 'path';
import { fileURLToPath } from 'url';
import { test, expect } from '@playwright/test';
import { startDummyRigctld, type DummyRigctld } from '../fixtures/rigctld-dummy.ts';
import { connectToDummy, disconnectFromDummy } from './connect-helper.ts';
import { DEFAULT_COMPACT_LAYOUT, DEFAULT_PHONE_LAYOUT } from '../../src/hooks/useLayoutConfig.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');

const layout = { compact: DEFAULT_COMPACT_LAYOUT, phone: DEFAULT_PHONE_LAYOUT };

test.describe('PTT hotkey against a real rigctld Dummy backend', () => {
  let dummy: DummyRigctld;

  test.beforeAll(async () => {
    dummy = await startDummyRigctld(REPO_ROOT);
  });

  test.afterAll(async () => {
    await dummy.stop();
  });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript((cfg) => {
      localStorage.setItem('grid-layout-v1', JSON.stringify(cfg));
      // Layout storage is keyed by the signed-in callsign (useLayoutConfig); the e2e user is ADMIN.
      localStorage.setItem('ADMIN:grid-layout-v1', JSON.stringify(cfg));
    }, layout);
  });

  // Runs before the rebind test so it exercises the untouched default
  // (rigctldSettings.pttKey persists server-side across specs in this
  // shared-server suite — see CLAUDE.md's e2e isolation notes).
  test('default AltLeft hotkey is momentary: engages PTT on hold, disengages on release', async ({ page }) => {
    await page.goto('/');
    await connectToDummy(page, dummy);

    const ptt = page.getByTestId('controls-ptt-button');
    await expect(ptt).toBeEnabled();

    // Move focus off any typing-target element (frequency input etc.).
    await page.getByRole('heading', { name: 'RigControl Web' }).click();

    await page.keyboard.down('AltLeft');
    await expect(ptt).toHaveClass(/border-red-500/, { timeout: 10_000 });
    await page.keyboard.up('AltLeft');
    await expect(ptt).not.toHaveClass(/border-red-500/, { timeout: 10_000 });

    await disconnectFromDummy(page);
  });

  test('rebinding the PTT hotkey rejects a key already bound to a CW binding', async ({ page }) => {
    await page.goto('/');
    await connectToDummy(page, dummy);

    await page.getByTitle('Rigctld Settings').click();
    // Default RIGCTLD tab is already active.
    const rebindBtn = page.getByRole('button', { name: 'AltLeft', exact: true });
    await expect(rebindBtn).toBeVisible();
    await rebindBtn.click();
    await expect(page.getByRole('button', { name: 'Press a key…', exact: true })).toBeVisible();

    // CW tab's default ditKey (constants.ts CW_SETTINGS_DEFAULTS).
    await page.keyboard.press('ControlLeft');
    await expect(page.getByText('Already bound to CW Dit', { exact: true })).toBeVisible();
    // Rejected — still capturing, still shows the unchanged AltLeft binding underneath.
    await expect(page.getByRole('button', { name: 'Press a key…', exact: true })).toBeVisible();

    // A free key succeeds.
    await page.keyboard.press('KeyG');
    await expect(page.getByRole('button', { name: 'KeyG', exact: true })).toBeVisible();

    await page.locator('button:has(svg.lucide-x)').click(); // close settings modal
    await page.getByRole('heading', { name: 'RigControl Web' }).click();

    const ptt = page.getByTestId('controls-ptt-button');
    await page.keyboard.down('KeyG');
    await expect(ptt).toHaveClass(/border-red-500/, { timeout: 10_000 });
    await page.keyboard.up('KeyG');
    await expect(ptt).not.toHaveClass(/border-red-500/, { timeout: 10_000 });

    // Restore the default so later spec runs see the documented AltLeft default.
    await page.getByTitle('Rigctld Settings').click();
    await page.getByRole('button', { name: 'KeyG', exact: true }).click();
    await page.keyboard.press('AltLeft');
    await expect(page.getByRole('button', { name: 'AltLeft', exact: true })).toBeVisible();
    await page.locator('button:has(svg.lucide-x)').click();

    await disconnectFromDummy(page);
  });
});

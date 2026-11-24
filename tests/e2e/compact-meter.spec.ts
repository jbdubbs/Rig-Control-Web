import path from 'path';
import { fileURLToPath } from 'url';
import { test, expect } from '../fixtures/test.ts';
import { startDummyRigctld, type DummyRigctld } from '../fixtures/rigctld-dummy.ts';
import { connectToDummy, disconnectFromDummy } from './connect-helper.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');

// Targets CompactLayout's own inline meter block ("case 'smeter':"), not
// TabbedMeterPanel.tsx/TabbedMeterHeaderContent — TabbedMeterPanel is only
// ever mounted by PhoneLayout, which the default desktop-viewport Playwright
// project never renders. CompactLayout hand-duplicates a similar but
// distinct 4-tab (adds VDD) version inline instead of reusing that
// component; this is real, pre-existing duplication (tech debt, not
// introduced by this test), not something fixed here.
test.describe('CompactLayout meter display against a real rigctld Dummy backend', () => {
  let dummy: DummyRigctld;

  test.beforeAll(async () => {
    dummy = await startDummyRigctld(REPO_ROOT);
  });

  test.afterAll(async () => {
    await dummy.stop();
  });

  test('all four meter tabs are present and switch the active tab client-side', async ({ page }) => {
    await page.goto('/');
    await connectToDummy(page, dummy);

    const tabs = {
      signal: page.getByTestId('meter-tab-signal'),
      swr: page.getByTestId('meter-tab-swr'),
      alc: page.getByTestId('meter-tab-alc'),
      vdd: page.getByTestId('meter-tab-vdd'),
    };
    for (const tab of Object.values(tabs)) {
      await expect(tab).toBeVisible();
    }

    // Default active tab is "signal" (usePanelState.ts).
    await expect(tabs.signal).toHaveClass(/bg-emerald-500/);
    await expect(tabs.swr).not.toHaveClass(/bg-emerald-500/);

    // Switching tabs is pure client state (setActiveMeter) — no socket
    // round trip needed, so this should be near-instant.
    await tabs.swr.click();
    await expect(tabs.swr).toHaveClass(/bg-emerald-500/);
    await expect(tabs.signal).not.toHaveClass(/bg-emerald-500/);

    await disconnectFromDummy(page);
  });

  test('the readout summary renders plausibly-formatted values', async ({ page }) => {
    await page.goto('/');
    await connectToDummy(page, dummy);

    // Format/presence only — Dummy's S-meter/SWR/ALC are static stub
    // values (confirmed live: STRENGTH=-22, SWR=0 regardless of rig
    // state), so this deliberately does not assert any causal response to
    // PTT/level changes, only that the panel renders *something* sane.
    const summary = page.getByTestId('meter-readout-summary');
    await expect(summary).toBeVisible({ timeout: 10_000 });
    await expect(summary).toContainText(/S\d+/); // e.g. "S5" at idle

    await disconnectFromDummy(page);
  });

  test('the chart renders without throwing', async ({ page }) => {
    await page.goto('/');
    await connectToDummy(page, dummy);

    const chart = page.getByTestId('meter-chart');
    await expect(chart).toBeVisible({ timeout: 10_000 });
    // Recharts renders an SVG line chart body — presence of any <svg> here
    // confirms the ResponsiveContainer/LineChart mounted and sized itself
    // (a common Recharts failure mode is a 0x0 container rendering nothing).
    await expect(chart.locator('svg')).toBeVisible();

    await disconnectFromDummy(page);
  });

  test('the collapse toggle hides and shows the chart', async ({ page }) => {
    await page.goto('/');
    await connectToDummy(page, dummy);

    const chart = page.getByTestId('meter-chart');
    const toggle = page.getByTestId('meter-collapse-toggle');
    await expect(chart).toBeVisible({ timeout: 10_000 });

    await toggle.click();
    await expect(chart).not.toBeVisible();

    await toggle.click();
    await expect(chart).toBeVisible();

    await disconnectFromDummy(page);
  });
});

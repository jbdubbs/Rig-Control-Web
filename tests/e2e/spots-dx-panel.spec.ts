import path from 'path';
import { fileURLToPath } from 'url';
import { test, expect } from '@playwright/test';
import { startDummyRigctld, type DummyRigctld } from '../fixtures/rigctld-dummy.ts';
import { startSyntheticDxCluster, type SyntheticDxCluster } from '../fixtures/synthetic-dx-cluster.ts';
import { DEFAULT_COMPACT_LAYOUT } from '../../src/hooks/useLayoutConfig.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');

function utcHHMM(d = new Date()): string {
  return `${String(d.getUTCHours()).padStart(2, '0')}${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

test.describe('DX Cluster spots panel via synthetic telnet feed', () => {
  let dummy: DummyRigctld;
  let cluster: SyntheticDxCluster;

  test.beforeAll(async () => {
    dummy = await startDummyRigctld(REPO_ROOT);
    cluster = await startSyntheticDxCluster();
  });

  test.afterAll(async () => {
    await cluster.stop();
    await dummy.stop();
  });

  test('connects, streams spots, filters, and tunes on click', async ({ page }) => {
    await page.addInitScript((cfg) => {
      localStorage.setItem('grid-layout-v1', JSON.stringify(cfg));
    }, {
      compact: {
        ...DEFAULT_COMPACT_LAYOUT,
        items: [
          // vfo is required here (not just spots_dx): the tune-on-click assertion
          // below reads the frequency back from VfoPanel's "Click to edit
          // frequency" input, which doesn't render unless 'vfo' is in the layout.
          { i: 'vfo', x: 0, y: 0, w: 9999, h: 1, minW: 2, minH: 1, panelType: 'vfo', fullWidth: true },
          { i: 'spots_dx', x: 0, y: 1, w: 1, h: 1, minW: 1, minH: 1, panelType: 'spots_dx' },
        ],
      },
      phone: { cols: 1, rows: 1, items: [] },
    });
    await page.goto('/');

    // Connect to the Dummy rig so tune-on-click has something to act on.
    await page.getByTitle('Rigctld Settings').click();
    await page
      .locator('div.space-y-1:has(label:text-is("Host Address")) input')
      .fill('127.0.0.1');
    await page
      .locator('div.space-y-1:has(label:text-is("Port")) input[type="number"]')
      .fill(String(dummy.port));
    await page.locator('button:has(svg.lucide-x)').click();
    await page.getByRole('button', { name: 'Connect', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Disconnect', exact: true })).toBeVisible({
      timeout: 10_000,
    });

    await expect(page.getByText('DX Cluster', { exact: true })).toBeVisible();

    // Point the DX cluster connection at the synthetic node and enable it.
    await page.getByTitle('Spot settings').click();
    await page.locator('div.space-y-1:has(label:text-is("Cluster Host")) input').fill('127.0.0.1');
    await page.locator('div.space-y-1:has(label:text-is("Port")) input').fill(String(cluster.port));
    await page.locator('div.space-y-1:has(label:text-is("Login Callsign")) input').fill('N0CALL');
    await page.locator('label:has-text("Enable DX Cluster") input[type="checkbox"]').click();
    await page.locator('button:has(svg.lucide-x)').click();

    const hhmm = utcHHMM();
    await expect(async () => {
      cluster.sendLine(
        `DX de W3LPL:     14025.0  JA1ABC       CQ CQ NA                    ${hhmm}Z`,
      );
      const row = page.locator('tr', { hasText: 'JA1ABC' });
      await expect(row).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 20_000 });

    const row = page.locator('tr', { hasText: 'JA1ABC' });
    await expect(row).toContainText('14.025');
    await expect(row).toContainText('W3LPL');
    await expect(row).toContainText('CQ CQ NA');

    // Callsign filter narrows the list.
    await page.getByTitle('Spot settings').click();
    await page
      .locator('div.space-y-1:has(label:text-is("Callsign / Prefix Filter")) input')
      .fill('ZZZZZ');
    await page.locator('button:has(svg.lucide-x)').click();
    await expect(page.locator('tr', { hasText: 'JA1ABC' })).toHaveCount(0);

    await page.getByTitle('Spot settings').click();
    await page
      .locator('div.space-y-1:has(label:text-is("Callsign / Prefix Filter")) input')
      .fill('');
    await page.locator('button:has(svg.lucide-x)').click();
    await expect(page.locator('tr', { hasText: 'JA1ABC' })).toBeVisible({ timeout: 5000 });

    // Tune-on-click sets the VFO frequency.
    await page.locator('tr', { hasText: 'JA1ABC' }).getByText('14.025').click();
    const freqInput = page.getByTitle('Click to edit frequency');
    await expect(freqInput).toHaveValue('14.025000', { timeout: 5000 });

    await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Connect', exact: true })).toBeVisible({
      timeout: 5_000,
    });
  });
});

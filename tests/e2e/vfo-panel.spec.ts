import path from 'path';
import { fileURLToPath } from 'url';
import { test, expect } from '../fixtures/test.ts';
import { startDummyRigctld, type DummyRigctld } from '../fixtures/rigctld-dummy.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');

// VfoPanel is the rig-status pilot rather than ControlsPanel: it exercises
// frequency/mode/vfo/split, the fields Hamlib's Dummy backend most reliably
// simulates. ControlsPanel's NB/NR/ANF/AGC rig *functions* are less
// predictable against Dummy and are left for incremental follow-up.
test.describe('VfoPanel against a real rigctld Dummy backend', () => {
  let dummy: DummyRigctld;

  test.beforeAll(async () => {
    dummy = await startDummyRigctld(REPO_ROOT);
  });

  test.afterAll(async () => {
    await dummy.stop();
  });

  test('connects, displays live frequency, and round-trips a frequency change', async ({ page }) => {
    await page.goto('/');

    // Point the client at the Dummy rigctld instance via the real Settings UI.
    await page.getByTitle('Rigctld Settings').click();
    // Scoped by label text: the modal also has a "Listen Address" field
    // (rigctld's own bind address) with the same 127.0.0.1 placeholder.
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

    // Dummy's default simulated frequency is 145 MHz.
    const freqInput = page.getByTitle('Click to edit frequency');
    await expect(freqInput).toHaveValue('145.000000', { timeout: 10_000 });

    // Edit the VFO frequency through the UI and confirm the full round trip:
    // browser -> Socket.io -> server sendToRig -> real rigctld -> Dummy
    // backend -> next poll -> rig-status -> panel re-render.
    await freqInput.fill('146.520000');
    await freqInput.press('Enter');
    await expect(freqInput).toHaveValue('146.520000', { timeout: 10_000 });

    // Disconnect cleanly before the Dummy rigctld process is stopped in
    // afterAll — all e2e specs share one server process for the run, and an
    // abrupt process kill while still "connected" reads as an unexpected
    // drop, triggering the server's 5s auto-reconnect loop against a port
    // that no longer exists and interfering with whichever spec runs next.
    await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Connect', exact: true })).toBeVisible({
      timeout: 5_000,
    });
  });
});

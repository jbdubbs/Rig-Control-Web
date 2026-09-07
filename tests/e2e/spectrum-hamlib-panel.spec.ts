import path from 'path';
import { fileURLToPath } from 'url';
import { test, expect } from '@playwright/test';
import { startDummyRigctld, type DummyRigctld } from '../fixtures/rigctld-dummy.ts';
import { sendSyntheticSpectrumPacket } from '../fixtures/synthetic-udp.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');

// Deliberately not the app's own multicast defaults (224.0.0.1:4531) — a
// real, currently-running instance of this app elsewhere on the host could
// be listening there for a real radio's real spectrum feed, and multicast
// traffic isn't scoped to a single process. Using a private, test-only
// group/port keeps synthetic frames from ever reaching a live deployment.
const MULTICAST_ADDR = '239.255.42.99';
const MULTICAST_PORT = 24531;

async function canvasFingerprint(canvas: import('@playwright/test').Locator): Promise<number> {
  return canvas.evaluate((el: HTMLCanvasElement) => {
    const ctx = el.getContext('2d')!;
    const { data } = ctx.getImageData(0, 0, el.width, el.height);
    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += data[i];
    return sum;
  });
}

test.describe('SpectrumHamlibPanel via synthetic UDP', () => {
  let dummy: DummyRigctld;

  test.beforeAll(async () => {
    dummy = await startDummyRigctld(REPO_ROOT);
  });

  test.afterAll(async () => {
    await dummy.stop();
  });

  test('renders and live-updates the spectrum canvas from synthetic UDP frames', async ({ page }) => {
    await page.goto('/');

    // Connect to the Dummy rig — the panel body only renders once `connected`
    // is true, and spectrumSupported (Dummy reports the SPECTRUM function)
    // only resolves after the capability probe on connect.
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

    // Enable the Hamlib UDP spectrum source and point it at the test-only
    // multicast group/port.
    await page.getByTitle('Spectrum scope settings').click();
    await page
      .locator('div.flex.items-center.justify-between', { hasText: 'Enable Spectrum Scope' })
      .getByRole('button')
      .click();
    // The enable click above fires its own save-settings round trip; wait for
    // its settings-data echo (still carrying the old default port) to land
    // and settle before editing the port field, or that echo can arrive after
    // the fill and clobber it back to the default.
    const portInput = page.locator(
      'div.flex.items-center.justify-between.gap-3:has(label:text-is("Multicast Port")) input',
    );
    await expect(portInput).toHaveValue("4531");
    // Fill+settle port first, then address last: each field's onBlur fires
    // its own save-settings round trip, and the resulting settings-data
    // echo can otherwise race and clobber whichever field was edited second.
    await portInput.fill(String(MULTICAST_PORT));
    await portInput.blur();
    await expect(portInput).toHaveValue(String(MULTICAST_PORT));
    const addrInput = page.locator(
      'div.flex.items-center.justify-between.gap-3:has(label:text-is("Multicast Address")) input',
    );
    await addrInput.fill(MULTICAST_ADDR);
    await addrInput.blur();
    await expect(addrInput).toHaveValue(MULTICAST_ADDR);
    await page.locator('button:has(svg.lucide-x)').click();

    const panel = page.locator(
      'xpath=//span[normalize-space(text())="Spectrum Scope"]/ancestor::div[contains(@class,"rounded-xl")][1]',
    );
    const spectrumCanvas = panel.locator('canvas').first();
    await expect(spectrumCanvas).toBeVisible();

    const baseline = await canvasFingerprint(spectrumCanvas);

    await sendSyntheticSpectrumPacket({
      multicastAddr: MULTICAST_ADDR,
      multicastPort: MULTICAST_PORT,
      amplitudes: new Array(100).fill(0), // quiet: draws flat at the bottom
      minStrength: -130,
      maxStrength: -20,
    });
    await expect(async () => {
      expect(await canvasFingerprint(spectrumCanvas)).not.toBe(baseline);
    }).toPass({ timeout: 5000 });
    const afterQuiet = await canvasFingerprint(spectrumCanvas);

    await sendSyntheticSpectrumPacket({
      multicastAddr: MULTICAST_ADDR,
      multicastPort: MULTICAST_PORT,
      amplitudes: new Array(100).fill(255), // strong: draws flat at the top
      minStrength: -130,
      maxStrength: -20,
    });
    await expect(async () => {
      expect(await canvasFingerprint(spectrumCanvas)).not.toBe(afterQuiet);
    }).toPass({ timeout: 5000 });

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

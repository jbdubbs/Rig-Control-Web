import path from 'path';
import { fileURLToPath } from 'url';
import { test, expect } from '@playwright/test';
import { startDummyRigctld, type DummyRigctld } from '../fixtures/rigctld-dummy.ts';
import { connectToDummy, disconnectFromDummy } from './connect-helper.ts';
import { DEFAULT_COMPACT_LAYOUT, DEFAULT_PHONE_LAYOUT } from '../../src/hooks/useLayoutConfig.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');

// Console panel isn't in the default layout (see command-console-panel.spec.ts)
// — needed here to directly query PTT state, since the normal rig-status
// poll loop is unavailable during this test (see comment below).
const layoutWithConsole = {
  compact: {
    ...DEFAULT_COMPACT_LAYOUT,
    items: [
      ...DEFAULT_COMPACT_LAYOUT.items,
      { i: 'commandconsole', x: 0, y: DEFAULT_COMPACT_LAYOUT.rows, w: 1, h: 1, minW: 1, minH: 1, panelType: 'commandconsole' as const },
    ],
  },
  phone: DEFAULT_PHONE_LAYOUT,
};

// Smoke test for the real keyboard -> socket -> server iambic FSM -> rig PTT
// wiring, using "rigctld-ptt" keying (server/cw.ts's sendCwCatPtt sends real
// "T 1"/"T 0" over the existing Dummy rigctld connection) so no serial
// hardware is needed at all. The exhaustive iambic timing logic itself
// (WPM math, squeeze behavior, buffer-depth jitter) is covered far more
// cheaply in server/cw.test.ts's fake-timers unit tests — this spec only
// proves the real end-to-end wiring works.
//
// Uses "Straight" keyer mode rather than iambic: a held straight key maps
// 1:1 to PTT on/off (cwTick's straight branch: wantDown = playheadStraight),
// where iambic mode would key repeating dit/dah elements on/off throughout
// the hold — a correct but noisier signal, harder to assert cleanly.
//
// Verification technique: NOT the controls-ptt-button's CSS class (the
// pattern controls-panel.spec.ts uses for user-clicked PTT). Confirmed live
// that won't work here: server/rigComm.ts's poll loop checks ctx.cwIsKeying
// and, while true, skips pollRig() entirely (rescheduling itself every 200ms
// without polling) to avoid queue contention with CW's own timing-sensitive
// commands. cwIsKeying stays true for the whole duration a key is held (it
// only clears 500ms after release), so status.ptt never updates via the
// normal poll while a key is down — the button's class can't reflect it.
// A raw console "t" query bypasses this entirely (it's a one-off command
// like any other, not gated on cwIsKeying), giving a direct, real readout.
test.describe('CW keyer against a real rigctld Dummy backend', () => {
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
    }, layoutWithConsole);
  });

  test('holding the straight-key binding keys PTT on, then off on release', async ({ page }) => {
    await page.goto('/');
    await connectToDummy(page, dummy);

    await page.getByTitle('Rigctld Settings').click();
    await page.getByRole('button', { name: 'cw', exact: true }).click();

    // Enable CW Keyer toggle: no data-testid, locate via its label text's
    // shared "flex items-center justify-between" parent.
    await page.getByText('Enable CW Keyer', { exact: true })
      .locator('xpath=../..').locator('button').click();
    await page.getByRole('button', { name: 'Straight', exact: true }).click();
    await page.getByRole('button', { name: 'CAT PTT', exact: true }).click();
    await page.locator('button:has(svg.lucide-x)').click();

    // Move focus off any element useCWKeyer.ts's isTypingTarget guard would
    // ignore (INPUT/TEXTAREA/SELECT/contentEditable) — the frequency input
    // and mode/bandwidth selects are all on this page.
    await page.getByRole('heading', { name: 'RigControl Web' }).click();

    const input = page.getByTestId('console-command-input');
    const send = page.getByTestId('console-send-button');
    const latest = page.getByTestId('console-log-entry').first();

    // Default straightKey binding is "Space" (constants.ts).
    await page.keyboard.down('Space');
    // Give the 60ms client->server buffer delay (CW_BUFFER_DEPTH_MS) time to
    // land before querying.
    await page.waitForTimeout(300);
    await input.fill('t');
    await send.click();
    await expect(latest).toContainText('PTT: 1', { timeout: 10_000 });

    await page.keyboard.up('Space');
    await page.waitForTimeout(300);
    await input.fill('t');
    await send.click();
    await expect(latest).toContainText('PTT: 0', { timeout: 10_000 });

    await disconnectFromDummy(page);
  });
});

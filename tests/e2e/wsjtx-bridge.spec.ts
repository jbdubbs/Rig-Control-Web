import path from 'path';
import { fileURLToPath } from 'url';
import { test, expect } from '@playwright/test';
import { startDummyRigctld, type DummyRigctld } from '../fixtures/rigctld-dummy.ts';
import { startWsjtxBridge, type WsjtxBridge } from '../fixtures/wsjtx-bridge.ts';
import { SyntheticWsjtxClient } from '../fixtures/synthetic-wsjtx-client.ts';
import { connectToDummy, disconnectFromDummy } from './connect-helper.ts';
import { DEFAULT_COMPACT_LAYOUT, DEFAULT_PHONE_LAYOUT } from '../../src/hooks/useLayoutConfig.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');

// Console panel needed for the real-PTT cross-check below (not in the
// default layout — see command-console-panel.spec.ts).
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

// Orchestrates 3 processes plus the real browser: a Dummy rigctld (Tier 3's
// fixture), the real committed wsjtx-bridge C binary, and a synthetic TCP
// client standing in for WSJT-X. useWsjtxBridge.ts auto-connects its
// WebSocket side whenever "wsjtx-bridge-enabled" is true in localStorage
// (read once at hook-init, so seeded via addInitScript before navigation —
// same pattern Tier 3 used for the console-panel layout) — no UI toggle
// click needed.
test.describe('WSJTX bridge against a real rigctld Dummy backend', () => {
  let dummy: DummyRigctld;
  let bridge: WsjtxBridge;

  test.beforeAll(async () => {
    dummy = await startDummyRigctld(REPO_ROOT);
    bridge = await startWsjtxBridge(REPO_ROOT);
  });

  test.afterAll(async () => {
    await bridge.stop();
    await dummy.stop();
  });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript((cfg) => {
      localStorage.setItem('grid-layout-v1', JSON.stringify(cfg));
      // Layout storage is keyed by the signed-in callsign (useLayoutConfig); the e2e user is ADMIN.
      localStorage.setItem('ADMIN:grid-layout-v1', JSON.stringify(cfg));
    }, layoutWithConsole);
    await page.addInitScript(({ wsPort }) => {
      localStorage.setItem('wsjtx-bridge-enabled', 'true');
      localStorage.setItem('wsjtx-bridge-ws-port', String(wsPort));
    }, { wsPort: bridge.wsPort });
  });

  test('dump_state reports ptt_type=0x1 and terminates with "done"', async ({ page }) => {
    await page.goto('/');
    await connectToDummy(page, dummy);

    const client = new SyntheticWsjtxClient();
    await client.connect(bridge.tcpPort);
    client.send('dump_state');
    const resp = await client.readUntilDone();
    expect(resp).toContain('ptt_type=0x1');
    client.close();

    await disconnectFromDummy(page);
  });

  test('GET "f" echoes the frequency the browser pushed via its rig-status WS message', async ({ page }) => {
    await page.goto('/');
    await connectToDummy(page, dummy);

    // Confirms the real relay: useWsjtxBridge's WS side auto-connects on
    // mount (bridgeEnabled is seeded true before navigation) and pushes
    // whatever rigStatus holds *at that instant* — which is still the app's
    // hardcoded default display frequency (14.074 MHz), since the bridge's
    // local WS connection completes well before connectToDummy's real rig
    // connection does. Confirmed live: querying "f" immediately after
    // connectToDummy returned "14074000", not Dummy's real 145 MHz.
    // useWsjtxBridge.ts:137-155 re-pushes on every rigStatus field change
    // though, so waiting for the real frequency to land in the UI (the same
    // signal connect-helper.ts's connectToDummy itself doesn't wait for)
    // guarantees a second, real push has already gone out by the time we
    // query — this is the actual relay behavior a real WSJT-X session would
    // see once the operator's rig is truly connected, not a case a real
    // user could hit by racing the two connections faster than we did here.
    await expect(page.getByTitle('Click to edit frequency')).toHaveValue('145.000000', { timeout: 10_000 });

    const client = new SyntheticWsjtxClient();
    await client.connect(bridge.tcpPort);
    client.send('f');
    const resp = await client.readLine();
    expect(resp.trim()).toBe('145000000');
    client.close();

    await disconnectFromDummy(page);
  });

  test('SET "T 1" relays through the browser to a real rigctld PTT round trip', async ({ page }) => {
    await page.goto('/');
    await connectToDummy(page, dummy);

    const client = new SyntheticWsjtxClient();
    await client.connect(bridge.tcpPort);
    client.send('T 1');
    // useWsjtxBridge.ts's handleCommand sends sendResult(true) immediately
    // for set-ptt (fire-and-forget — see CLAUDE.md's WSJTX known-issues
    // note), so "RPRT 0" only proves the WS message was relayed and
    // acknowledged by the browser, not that the radio actually keyed.
    const resp = await client.readLine();
    expect(resp.trim()).toBe('RPRT 0');

    // Real confirmation: query the rig directly through the console panel.
    const input = page.getByTestId('console-command-input');
    const send = page.getByTestId('console-send-button');
    const latest = page.getByTestId('console-log-entry').first();
    await input.fill('t');
    await send.click();
    await expect(latest).toContainText('PTT: 1', { timeout: 10_000 });

    // Release, to leave the shared Dummy connection in a clean state for
    // any other test that reuses it.
    client.send('T 0');
    await client.readLine();
    await input.fill('t');
    await send.click();
    await expect(latest).toContainText('PTT: 0', { timeout: 10_000 });

    client.close();
    await disconnectFromDummy(page);
  });
});

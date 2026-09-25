import path from 'path';
import { fileURLToPath } from 'url';
import { test, expect } from '@playwright/test';
import { startDummyRigctld, type DummyRigctld } from '../fixtures/rigctld-dummy.ts';
import { connectToDummy, disconnectFromDummy } from './connect-helper.ts';
import { DEFAULT_COMPACT_LAYOUT, DEFAULT_PHONE_LAYOUT } from '../../src/hooks/useLayoutConfig.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');

// CommandConsolePanel ("commandconsole") isn't in the default compact grid
// layout (see DEFAULT_COMPACT_LAYOUT in useLayoutConfig.ts) — a real user
// adds it via Edit Layout -> Add Panel. Seeded here via localStorage instead
// of driving that UI, to keep this spec's focus on the console panel itself.
//
// useLayoutConfig namespaces its storage key by the signed-in callsign
// ("ADMIN:grid-layout-v1" for the e2e user) since the #111 layout-restore
// fix; before that it always used the bare "grid-layout-v1". Seed both so
// the layout applies regardless of which key is read first.
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

test.describe('CommandConsolePanel against a real rigctld Dummy backend', () => {
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

  test('shows the empty state before any command is sent', async ({ page }) => {
    await page.goto('/');
    await connectToDummy(page, dummy);

    await expect(page.getByTestId('console-empty-state')).toBeVisible();
    await expect(page.getByTestId('console-log-entry')).toHaveCount(0);

    await disconnectFromDummy(page);
  });

  test('sends "f" and shows the frequency in the response', async ({ page }) => {
    await page.goto('/');
    await connectToDummy(page, dummy);

    const input = page.getByTestId('console-command-input');
    const send = page.getByTestId('console-send-button');

    await input.fill('f');
    await send.click();

    // Newest entry is prepended, so the first log entry is always the latest.
    // The logged CMD echoes the fully-formatted command (formatRawCommand
    // prefixes the bare "f" the user typed with "+", not "+\" — see
    // useRigControl.ts), not the raw input.
    const latest = page.getByTestId('console-log-entry').first();
    await expect(latest).toContainText('CMD: +f');
    // Dummy's default simulated frequency is 145 MHz — round trip:
    // browser -> send-raw "+f" -> rigctld -> Dummy -> raw-response.
    await expect(latest).toContainText('145000000');

    await disconnectFromDummy(page);
  });

  test('sends "m" and shows the mode in the response', async ({ page }) => {
    await page.goto('/');
    await connectToDummy(page, dummy);

    const input = page.getByTestId('console-command-input');
    const send = page.getByTestId('console-send-button');

    await input.fill('m');
    await send.click();

    const latest = page.getByTestId('console-log-entry').first();
    await expect(latest).toContainText('CMD: +m');
    // Dummy's default startup mode is FM (verified live against a real
    // Dummy instance: `m` -> "Mode: FM").
    await expect(latest).toContainText('FM');

    await disconnectFromDummy(page);
  });

  test('does not clear the input after submit', async ({ page }) => {
    await page.goto('/');
    await connectToDummy(page, dummy);

    const input = page.getByTestId('console-command-input');
    const send = page.getByTestId('console-send-button');

    await input.fill('f');
    await send.click();
    await expect(page.getByTestId('console-log-entry').first()).toContainText('CMD: +f');
    // Source confirms handleSendRaw never calls setRawCommand("") — the
    // input retains its last-typed value after submit, by design.
    await expect(input).toHaveValue('f');

    // Non-goal, intentionally not covered here: the 50-entry rolling log
    // cap. Better covered at the Tier 2 hook level (a fast, deterministic
    // unit test); driving 50 real round trips through a live Dummy e2e run
    // would be slow and flaky for marginal additional value.

    await disconnectFromDummy(page);
  });
});

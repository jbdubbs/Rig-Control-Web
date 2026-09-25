import path from 'path';
import { fileURLToPath } from 'url';
import { test, expect } from '@playwright/test';
import { startDummyRigctld, type DummyRigctld } from '../fixtures/rigctld-dummy.ts';
import { connectToDummy, disconnectFromDummy } from './connect-helper.ts';
import { DEFAULT_COMPACT_LAYOUT, DEFAULT_PHONE_LAYOUT } from '../../src/hooks/useLayoutConfig.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');

// Every test in this file seeds the console panel into the layout (see
// command-console-panel.spec.ts for why it isn't there by default) — the
// Tune-when-on test needs it to seed rig state the UI alone can't reach.
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

test.describe('ControlsPanel against a real rigctld Dummy backend', () => {
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

  test('PTT round-trips through set-ptt', async ({ page }) => {
    await page.goto('/');
    await connectToDummy(page, dummy);

    const ptt = page.getByTestId('controls-ptt-button');
    await expect(ptt).toBeEnabled();
    await ptt.click();
    await expect(ptt).toHaveClass(/border-red-500/, { timeout: 10_000 });
    await ptt.click();
    await expect(ptt).not.toHaveClass(/border-red-500/, { timeout: 10_000 });

    await disconnectFromDummy(page);
  });

  test('Attenuator cycles through levels via set-level', async ({ page }) => {
    await page.goto('/');
    await connectToDummy(page, dummy);

    // Dummy's dump_caps advertises "Attenuator: 10dB 20dB 30dB" — a
    // non-empty capability list, so the button should be enabled once the
    // post-connect dump_caps probe completes.
    const atten = page.getByTestId('controls-attenuator-button');
    await expect(atten).toBeEnabled({ timeout: 10_000 });
    const initialLabel = await atten.innerText();
    await atten.click();
    await expect(atten).not.toHaveText(initialLabel, { timeout: 10_000 });

    await disconnectFromDummy(page);
  });

  test('Preamp cycles through levels via set-level', async ({ page }) => {
    await page.goto('/');
    await connectToDummy(page, dummy);

    // Dummy's dump_caps advertises "Preamp: 10dB".
    const preamp = page.getByTestId('controls-preamp-button');
    await expect(preamp).toBeEnabled({ timeout: 10_000 });
    const initialLabel = await preamp.innerText();
    await preamp.click();
    await expect(preamp).not.toHaveText(initialLabel, { timeout: 10_000 });

    await disconnectFromDummy(page);
  });

  test('AGC cycles through levels via set-level', async ({ page }) => {
    await page.goto('/');
    await connectToDummy(page, dummy);

    // Dummy's dump_caps advertises 7 distinct AGC levels.
    const agc = page.getByTestId('controls-agc-button');
    await expect(agc).toBeEnabled({ timeout: 10_000 });
    const initialLabel = await agc.innerText();
    await agc.click();
    await expect(agc).not.toHaveText(initialLabel, { timeout: 10_000 });

    await disconnectFromDummy(page);
  });

  test('NB/NR/ANF toggle round-trip via set-func', async ({ page }) => {
    await page.goto('/');
    await connectToDummy(page, dummy);

    // All three are in Dummy's advertised "Set functions" list (confirmed
    // live: FAGC NB COMP VOX TONE TSQL SBKIN FBKIN ANF NR ...) — these are
    // func on/off toggles, distinct from the NB/NR *level* sliders
    // (RfLevelsPanel), which are unaffected by this test.
    // Note: the "off" state's own class string includes the Tailwind hover
    // variant "hover:border-emerald-500", which contains "border-emerald-500"
    // as a plain substring — an unanchored regex would match both states.
    // The negative lookbehind requires the real (non-hover-prefixed) class.
    const activeClass = /(?<!hover:)border-emerald-500/;
    for (const testId of ['controls-nb-button', 'controls-nr-button', 'controls-anf-button']) {
      const btn = page.getByTestId(testId);
      await expect(btn).toBeEnabled({ timeout: 10_000 });
      await btn.click();
      await expect(btn).toHaveClass(activeClass, { timeout: 10_000 });
      await btn.click();
      await expect(btn).not.toHaveClass(activeClass, { timeout: 10_000 });
    }

    await disconnectFromDummy(page);
  });

  test('Power indicator reflects Dummy\'s get_powerstat state', async ({ page }) => {
    await page.goto('/');
    await connectToDummy(page, dummy);

    // Confirmed live: Dummy's get_powerstat defaults to Power Status: 1 (on).
    const power = page.getByTestId('controls-power-indicator');
    await expect(power).toBeVisible({ timeout: 10_000 });
    await expect(power).toHaveAttribute('title', 'Radio ON — click to power off', { timeout: 10_000 });

    await disconnectFromDummy(page);
  });

  test('Tune-when-off: reflects optimistic isTuning state, but RIG_OP_TUNE is a confirmed no-op in Dummy', async ({ page }) => {
    await page.goto('/');
    await connectToDummy(page, dummy);

    const tune = page.getByTestId('controls-tune-button');
    await expect(tune).toBeEnabled();
    await tune.click();
    // isTuning is set synchronously client-side on click — no round trip
    // needed for this assertion.
    await expect(tune).toHaveClass(/bg-red-500\/20/);

    // Deliberately NOT asserting eventual completion: Hamlib's dummy.c
    // handles RIG_OP_TUNE as "case RIG_OP_TUNE: /* NOP */ break;" — the
    // vfo_op succeeds (RPRT 0) but never touches the TUNER function state,
    // confirmed live (+G TUNE succeeds, a subsequent +u TUNER is unchanged).
    // status.tuner will never organically become true from this click —
    // the button rides out its 15s local timeout and reverts. See the
    // "Tune-when-on" test below for the real, reachable round trip.

    await disconnectFromDummy(page);
  });

  test('Tune-when-on: real set-func TUNER false round trip, seeded via the console panel', async ({ page }) => {
    // Above the default 30s test timeout: the wait below for the slow poll
    // cycle can alone take up to ~25s (see comment there).
    test.setTimeout(45_000);

    await page.goto('/');
    await connectToDummy(page, dummy);

    // RIG_OP_TUNE never turns TUNER on organically in Dummy (see the
    // Tune-when-off test), so this path is unreachable through UI-only
    // interaction. Seed status.tuner = true directly via a raw command,
    // the same way a real user could through the Command Console.
    const input = page.getByTestId('console-command-input');
    const send = page.getByTestId('console-send-button');
    await input.fill('U TUNER 1');
    await send.click();
    await expect(page.getByTestId('console-log-entry').first()).toContainText('set_func');

    // Wait for the next 2s poll to pick up status.tuner: true and flip the
    // Tune button into its "tuned" (green) visual state.
    // Long timeout, confirmed necessary (not just generous padding): per
    // server/rigComm.ts, "tuner" is only re-read on the *slow* poll cycle
    // (every 10th cycle, isSlowPoll = pollCycleCount % 10 === 0) or when
    // set-func's handler adds 'tuner' to ctx.pendingQuickPolls for a fast
    // follow-up poll. Seeding via a raw console command bypasses set-func
    // entirely, so nothing schedules a quick poll — the only path to
    // status.tuner picking up the change is the next slow poll, up to
    // 10 * ctx.pollRate (default 2000ms) = ~20s away in the worst case.
    const tune = page.getByTestId('controls-tune-button');
    await expect(tune).toHaveClass(/bg-emerald-500\/10/, { timeout: 25_000 });

    // Now the real round trip: ControlsPanel's own logic
    // (status.tuner ? handleSetFunc("TUNER", false) : handleVfoOp("TUNE"))
    // takes the turn-off branch, which Dummy does implement statefully
    // (confirmed live: +U TUNER 1 -> +u TUNER reads back 1). This one goes
    // through set-func, so it gets a fast pendingQuickPolls follow-up —
    // no need for the same long timeout.
    await tune.click();
    await expect(tune).not.toHaveClass(/bg-emerald-500\/10/, { timeout: 10_000 });

    await disconnectFromDummy(page);
  });
});

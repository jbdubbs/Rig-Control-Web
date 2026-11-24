import path from 'path';
import { fileURLToPath } from 'url';
import { test, expect, type Locator } from '../fixtures/test.ts';
import { startDummyRigctld, type DummyRigctld } from '../fixtures/rigctld-dummy.ts';
import { connectToDummy, disconnectFromDummy } from './connect-helper.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');

// Playwright can't simulate a real drag's intermediate pointer events on a
// native <input type="range">, so these tests set .value via evaluate() and
// dispatch input/change (matching what a real drag ultimately produces),
// then wait past the hook's 1000ms debounce (useRigControl.ts) before
// asserting. set-level's server handler optimistically updates and emits
// rig-status immediately on command completion (server/rigComm.ts:938-941),
// so no slow-poll wait is needed here (unlike controls-panel.spec.ts's
// Tune-when-on case).
async function dragRangeTo(locator: Locator, value: number) {
  await locator.evaluate((el: HTMLInputElement, v: number) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
    setter.call(el, String(v));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}

test.describe('RfLevelsPanel against a real rigctld Dummy backend', () => {
  let dummy: DummyRigctld;

  test.beforeAll(async () => {
    dummy = await startDummyRigctld(REPO_ROOT);
  });

  test.afterAll(async () => {
    await dummy.stop();
  });

  test('RF Power slider round-trips through set-level', async ({ page }) => {
    await page.goto('/');
    await connectToDummy(page, dummy);

    // Dummy's dump_caps: RFPOWER(0.050000..1.000000/0.001957) -> the
    // component multiplies by 100 for a watts-ish display scale.
    const slider = page.getByTestId('rflevels-rfpower-slider');
    await expect(slider).toBeEnabled({ timeout: 10_000 });
    await dragRangeTo(slider, 75);
    await page.waitForTimeout(1500);
    // Not an exact match: Dummy's own RFPOWER step granularity (~0.00196)
    // quantizes the set value server-side before echoing it back (observed
    // live: setting exactly 75 round-trips as ~75.06), so this confirms the
    // real round trip landed near the target rather than snapping back to
    // the pre-drag default, without over-asserting exact float precision.
    await expect.poll(async () => parseFloat(await slider.inputValue()), { timeout: 10_000 })
      .toBeGreaterThan(74);
    await expect.poll(async () => parseFloat(await slider.inputValue()))
      .toBeLessThan(76);

    await disconnectFromDummy(page);
  });

  test('RF Level slider round-trips through set-level', async ({ page }) => {
    await page.goto('/');
    await connectToDummy(page, dummy);

    // Dummy's dump_caps: RF(0.000000..1.000000/0.003922) -> the slider's
    // min/max/step are bound to that real capability range (RfLevelsPanel.tsx
    // gates visibility on rfLevelCapabilities.supported, derived from the
    // rig's actual "Get level:" RF(...) entry, distinct from RIG_FUNC_RF).
    // Chromium's native <input type="range"> value-sanitization snaps a
    // programmatically-set value to the nearest step multiple, so — like the
    // RF Power slider above — this is a tolerance check, not an exact match:
    // 0.7 snaps to 178 * 0.003922 =~ 0.698116.
    const slider = page.getByTestId('rflevels-rflevel-slider');
    await expect(slider).toBeEnabled({ timeout: 10_000 });
    await dragRangeTo(slider, 0.7);
    await page.waitForTimeout(1500);
    await expect.poll(async () => parseFloat(await slider.inputValue()), { timeout: 10_000 })
      .toBeGreaterThan(0.69);
    await expect.poll(async () => parseFloat(await slider.inputValue()))
      .toBeLessThan(0.71);

    await disconnectFromDummy(page);
  });

  // DNR Level and NB Level are both deliberately NOT given a value
  // round-trip test. Confirmed live and via Hamlib source: Dummy's
  // level_gran table only defines a real step for CWPITCH — NR and NB both
  // report a degenerate range from \dump_caps ("NR(0.000000..0.000000/
  // 0.000000)", "NB(0.000000..0.000000/0.000000)"). Both sliders are gated
  // on levelSupported (whether NR/NB actually appear in dump_caps's "Get
  // level:" line, distinct from the RIG_FUNC_NR/RIG_FUNC_NB on/off funcs) —
  // true for Dummy either way, since it lists both with this degenerate
  // range rather than omitting them. RfLevelsPanel guards the DNR slider's
  // step-index math against the zero step (rendering a fixed "Lvl 0"
  // instead of "Lvl NaN"); NB Level has no such guard since its range is
  // used directly as the native <input> min/max/step, which tolerates
  // min===max===step===0 without dividing by anything. This is a Dummy-only
  // simulator artifact (real radios report real level_gran for NR/NB), not
  // a production bug worth changing — see the underlying rig level itself
  // *is* genuinely settable (confirmed via raw "L NB 0.35" / "l NB" round
  // trip), only the slider's UI-imposed bounds are degenerate here.

  test('DNR Level slider is present and enabled (no value round trip — see comment above)', async ({ page }) => {
    await page.goto('/');
    await connectToDummy(page, dummy);

    const slider = page.getByTestId('rflevels-dnr-slider');
    await expect(slider).toBeEnabled({ timeout: 10_000 });

    await disconnectFromDummy(page);
  });

  test('NB Level slider is present and enabled (no value round trip — see comment above)', async ({ page }) => {
    await page.goto('/');
    await connectToDummy(page, dummy);

    // Conditionally rendered only when nbCapabilities.levelSupported — true
    // against Dummy (NB appears, if with a degenerate range, in dump_caps's
    // "Get level:" line).
    const slider = page.getByTestId('rflevels-nb-slider');
    await expect(slider).toBeEnabled({ timeout: 10_000 });

    await disconnectFromDummy(page);
  });
});

import path from 'path';
import { fileURLToPath } from 'url';
import { test, expect } from '../fixtures/test.ts';
import { startDummyRigctld, type DummyRigctld } from '../fixtures/rigctld-dummy.ts';
import { connectToDummy, disconnectFromDummy } from './connect-helper.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');

// ModeBwPanel is rendered twice inside VfoPanel.tsx: VfoPanel itself branches
// on its own `variant` prop with an early return ("compact" branch returns
// first; "phone" is the trailing fallthrough return) — never both mounted
// simultaneously, one per parent layout (CompactLayout vs PhoneLayout). The
// default Playwright project uses a desktop-width viewport, so CompactLayout
// is what actually renders, and only the "-compact" testid suffix ever
// appears in the DOM. The "-phone" instance is reachable only under
// PhoneLayout (viewport < 768px), which no current e2e project exercises.
test.describe('ModeBwPanel against a real rigctld Dummy backend', () => {
  let dummy: DummyRigctld;

  test.beforeAll(async () => {
    dummy = await startDummyRigctld(REPO_ROOT);
  });

  test.afterAll(async () => {
    await dummy.stop();
  });

  test('round-trips a mode change', async ({ page }) => {
    await page.goto('/');
    await connectToDummy(page, dummy);

    const modeSelect = page.getByTestId('modebw-mode-select-compact');
    // Dummy's default startup mode is FM (verified live: `m` -> "Mode: FM").
    await expect(modeSelect).toHaveValue('FM', { timeout: 10_000 });

    await modeSelect.selectOption('USB');
    // Round trip: browser -> set-mode -> rigctld `M USB -1` -> Dummy ->
    // next poll's `m` read -> rig-status -> select re-renders with the
    // server-confirmed value.
    await expect(modeSelect).toHaveValue('USB', { timeout: 10_000 });

    await modeSelect.selectOption('CW');
    await expect(modeSelect).toHaveValue('CW', { timeout: 10_000 });

    await disconnectFromDummy(page);
  });

  test('round-trips a bandwidth change', async ({ page }) => {
    await page.goto('/');
    await connectToDummy(page, dummy);

    const bwSelect = page.getByTestId('modebw-bw-select-compact');
    await expect(bwSelect).toBeEnabled({ timeout: 10_000 });

    // Kept independent of the mode test above: selecting a mode sends
    // bandwidth "-1" (a reset-to-default sentinel) server-side, so bandwidth
    // state shouldn't be assumed stable across a mode change — this test
    // drives its own bandwidth value from whatever the panel currently shows.
    await bwSelect.selectOption('500');
    await expect(bwSelect).toHaveValue('500', { timeout: 10_000 });

    await bwSelect.selectOption('2400');
    await expect(bwSelect).toHaveValue('2400', { timeout: 10_000 });

    await disconnectFromDummy(page);
  });
});

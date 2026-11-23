import path from 'path';
import { fileURLToPath } from 'url';
import { test, expect } from '@playwright/test';
import { startDummyRigctld, type DummyRigctld } from '../fixtures/rigctld-dummy.ts';
import { connectToDummy, disconnectFromDummy } from './connect-helper.ts';
import { DEFAULT_COMPACT_LAYOUT, DEFAULT_PHONE_LAYOUT } from '../../src/hooks/useLayoutConfig.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');

const layout = { compact: DEFAULT_COMPACT_LAYOUT, phone: DEFAULT_PHONE_LAYOUT };

// Issue #124: an iOS PWA can be backgrounded (home-bar swipe) while the touch PTT button is held,
// and the browser may never deliver pointerup/pointercancel. Two layers keep the radio from being
// left keyed, each tested separately here:
//   1. client: the phone PTT button force-releases on blur / hidden / pagehide
//   2. server: if the socket that keyed PTT disconnects, the server unkeys the rig itself
// Observation technique: a second, compact-layout client's PTT button reflects the rig's real
// polled PTT state (the same observer controls-panel.spec.ts uses).
test.describe('PTT is released when the keying client goes away (#124)', () => {
  let dummy: DummyRigctld;

  test.beforeAll(async () => {
    dummy = await startDummyRigctld(REPO_ROOT);
  });

  test.afterAll(async () => {
    await dummy.stop();
  });

  const initLayout = (cfg: typeof layout) => {
    localStorage.setItem('grid-layout-v1', JSON.stringify(cfg));
    // Layout storage is keyed by the signed-in callsign (useLayoutConfig); the e2e user is ADMIN.
    localStorage.setItem('ADMIN:grid-layout-v1', JSON.stringify(cfg));
  };

  test('client releases PTT on window blur while the phone PTT button is held', async ({ page, browser }) => {
    await page.addInitScript(initLayout, layout);
    await page.goto('/');
    await connectToDummy(page, dummy);
    const observerPtt = page.getByTestId('controls-ptt-button');

    const phoneCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const phone = await phoneCtx.newPage();
    await phone.addInitScript(initLayout, layout);
    await phone.goto('/');
    const phonePtt = phone.getByTestId('phone-ptt-button');
    await expect(phonePtt).toBeEnabled({ timeout: 10_000 });

    await phonePtt.hover();
    await phone.mouse.down();
    await expect(observerPtt).toHaveClass(/border-red-500/, { timeout: 10_000 });

    // Simulates focus/visibility loss with no pointerup ever delivered.
    await phone.evaluate(() => window.dispatchEvent(new Event('blur')));
    await expect(observerPtt).not.toHaveClass(/border-red-500/, { timeout: 10_000 });

    await phone.mouse.up();
    await phoneCtx.close();
    await disconnectFromDummy(page);
  });

  test('server releases PTT when the socket that keyed it disconnects', async ({ page, browser }) => {
    await page.addInitScript(initLayout, layout);
    await page.goto('/');
    await connectToDummy(page, dummy);
    const observerPtt = page.getByTestId('controls-ptt-button');

    const phoneCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const phone = await phoneCtx.newPage();
    await phone.addInitScript(initLayout, layout);
    // Swallow the page's focus/visibility listeners so the client-side safety net can't run: only
    // the server's disconnect handler is left to unkey the rig (a suspended iOS page can run no JS).
    await phone.addInitScript(() => {
      const blocked = new Set(['blur', 'pagehide', 'visibilitychange']);
      for (const target of [window, document] as EventTarget[]) {
        const orig = target.addEventListener.bind(target);
        target.addEventListener = ((type: string, ...rest: unknown[]) => {
          if (blocked.has(type)) return;
          return (orig as (...a: unknown[]) => void)(type, ...rest);
        }) as typeof target.addEventListener;
      }
    });
    await phone.goto('/');
    const phonePtt = phone.getByTestId('phone-ptt-button');
    await expect(phonePtt).toBeEnabled({ timeout: 10_000 });

    await phonePtt.hover();
    await phone.mouse.down();
    await expect(observerPtt).toHaveClass(/border-red-500/, { timeout: 10_000 });

    // Drop the keying client entirely while PTT is still held.
    await phoneCtx.close();
    await expect(observerPtt).not.toHaveClass(/border-red-500/, { timeout: 15_000 });

    await disconnectFromDummy(page);
  });
});

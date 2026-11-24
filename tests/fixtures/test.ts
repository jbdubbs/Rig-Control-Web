import { test as base, type Browser } from '@playwright/test';
import { routeSpots } from './spot-fixtures.ts';

// Shared `test` for every e2e spec. It makes the POTA/SOTA/WWFF spot feeds hermetic:
// the default layout contains the combo spots panel, so every page load fetches all three
// live APIs (twice each under the dev server's StrictMode), and a full run from one IP gets
// rate-limited by spots.wwff.co. Under a 429 the WWFF request stays pending, so
// global-setup's `networkidle` wait never resolves and every spec fails.
//
// Every browser context created in a worker (the built-in `context`/`page` fixtures and
// specs' own `browser.newContext()` calls alike) gets the fixture routes. A spec's own
// `routeSpots(page, ...)` override still wins, since page routes run before context routes.
//
// Live polling is opt-in, for the pre-release check only: tests/e2e/spots-live.spec.ts sets
// `liveSpots: true` and is skipped unless RCW_E2E_LIVE_SPOTS=1 (npm run test:e2e:live-spots).
export const test = base.extend<object, { liveSpots: boolean }>({
  liveSpots: [false, { option: true, scope: 'worker' }],

  browser: [
    async ({ browser, liveSpots }, use) => {
      if (liveSpots) {
        await use(browser);
        return;
      }
      const original = browser.newContext.bind(browser);
      (browser as Browser).newContext = async (...args: Parameters<Browser['newContext']>) => {
        const context = await original(...args);
        await routeSpots(context);
        return context;
      };
      try {
        await use(browser);
      } finally {
        (browser as Browser).newContext = original;
      }
    },
    { scope: 'worker' },
  ],
});

export { expect } from '@playwright/test';
export type { Browser, BrowserContext, Locator, Page } from '@playwright/test';

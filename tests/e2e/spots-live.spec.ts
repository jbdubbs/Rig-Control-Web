import { test, expect, type Page } from '../fixtures/test.ts';

// Pre-release check ONLY: polls the real POTA, SOTA and WWFF APIs from the browser, with no
// mocking, to catch what the mocked suite cannot: an API moving, changing its response shape,
// or dropping CORS headers. Every other spec mocks these feeds (tests/fixtures/test.ts) because
// repeated live polling gets this IP rate-limited by spots.wwff.co.
//
// Skipped unless RCW_E2E_LIVE_SPOTS=1. Run it with `npm run test:e2e:live-spots`, once, as part
// of the pre-release checklist. If it fails with a 429, wait a few minutes before retrying.
test.skip(process.env.RCW_E2E_LIVE_SPOTS !== '1', 'live spot polling is opt-in: npm run test:e2e:live-spots');
test.use({ liveSpots: true });

// The fields usePotaSpots.tsx's accessors actually read, per feed (potaAccessors,
// sotaAccessors, wwffAccessors). A missing one means the app silently drops or misreads spots.
const FEEDS = [
  {
    name: 'POTA',
    url: 'https://api.pota.app/spot/',
    fields: ['activator', 'spotTime', 'spotId', 'frequency', 'mode'],
  },
  {
    name: 'SOTA',
    url: 'https://api2.sota.org.uk/api/spots/-1/all',
    fields: ['activatorCallsign', 'timeStamp', 'id', 'frequency', 'mode'],
  },
  {
    name: 'WWFF',
    url: 'https://spots.wwff.co/static/spots.json',
    fields: ['activator', 'spot_time', 'id', 'frequency_khz', 'mode'],
  },
] as const;

// The pending request that stalls networkidle under a 429 never resolves, so always bound waits.
const FEED_TIMEOUT_MS = 20_000;

async function expectTabRendered(page: Page, name: string) {
  await page.getByRole('button', { name, exact: true }).click();
  const hasRows = page.locator('tbody tr').first();
  const emptyState = page.getByText(new RegExp(`No ${name} spots in the last \\d+ min`));
  await expect(hasRows.or(emptyState).first()).toBeVisible({ timeout: 10_000 });
}

test.describe('live POTA/SOTA/WWFF feeds (pre-release)', () => {
  test('all three real APIs answer 200 with the shape the app parses, and the panel renders them', async ({ page }) => {
    const responses = FEEDS.map((feed) =>
      page.waitForResponse((r) => r.url() === feed.url, { timeout: FEED_TIMEOUT_MS }),
    );
    await page.goto('/');

    const results = await Promise.all(responses);

    for (const [i, feed] of FEEDS.entries()) {
      const res = results[i];
      expect(res.status(), `${feed.name} ${feed.url} status`).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body), `${feed.name} body is a JSON array`).toBe(true);
      if (body.length > 0) {
        for (const field of feed.fields) {
          expect(body[0], `${feed.name} spot has "${field}"`).toHaveProperty(field);
        }
      }
    }

    for (const feed of FEEDS) await expectTabRendered(page, feed.name);
  });
});

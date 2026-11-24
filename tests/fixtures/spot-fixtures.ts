import type { BrowserContext, Page } from '@playwright/test';

// usePotaSpots.tsx parses spotTime/timeStamp as `new Date(s + 'Z').getTime()`
// (the trailing Z is appended by the code, not present in the API's own
// format) — timestamps here must omit it too, or the 15-minute maxAge filter
// silently drops the fixture.
export function isoNoZ(d: Date): string {
  return d.toISOString().slice(0, 19);
}

const now = () => new Date();

export const POTA_FIXTURE = [{
  activator: 'W1ABC',
  spotTime: isoNoZ(now()),
  frequency: 14074, // kHz — displayed as frequency/1000 = "14.074"
  mode: 'FT8',
  locationDesc: 'US-CT',
  reference: 'K-1234',
  name: 'Test Park',
  spotId: 1001,
}];

export const SOTA_FIXTURE = [{
  activatorCallsign: 'W2XYZ',
  timeStamp: isoNoZ(now()),
  frequency: '14.285', // MHz, string
  mode: 'SSB',
  associationCode: 'W2',
  summitCode: 'NS-001',
  id: 2001,
}];

export const WWFF_FIXTURE = [{
  activator: 'W3DEF',
  spot_time: Math.floor(now().getTime() / 1000), // unix seconds
  // Deliberately not 14074/7074 kHz: those are the app's built-in default
  // VFO A/B display frequencies (14.074/7.074 MHz, standard FT8 calling
  // channels — see constants/last-vfoA/last-vfoB defaults), which would
  // make usePotaSpots.tsx's "spot matches current frequency" pinning logic
  // duplicate this row (confirmed live — an earlier version of this fixture
  // used 7074 and hit exactly that).
  frequency_khz: 5357,
  mode: 'FT8',
  reference: 'KFF-0001',
  reference_name: 'Test Forest',
  id: 3001,
}];

// Accepts a Page (per-test overrides, which take precedence over context routes) or a
// BrowserContext (the suite-wide default installed by tests/fixtures/test.ts).
export async function routeSpots(page: Page | BrowserContext, opts: { pota?: unknown; sota?: unknown; wwff?: unknown } = {}) {
  await page.route('https://api.pota.app/spot/', (route) =>
    route.fulfill({ json: opts.pota ?? POTA_FIXTURE }));
  await page.route('https://api2.sota.org.uk/api/spots/-1/all', (route) =>
    route.fulfill({ json: opts.sota ?? SOTA_FIXTURE }));
  await page.route('https://spots.wwff.co/static/spots.json', (route) =>
    route.fulfill({ json: opts.wwff ?? WWFF_FIXTURE }));
}

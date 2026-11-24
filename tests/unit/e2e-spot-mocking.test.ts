// @vitest-environment node
import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

// Every e2e spec must take `test` from tests/fixtures/test.ts, which mocks the POTA/SOTA/WWFF feeds
// for every browser context. A spec importing `test` straight from '@playwright/test' would poll the
// live APIs on each page load and bring back the spots.wwff.co rate-limit failures (global-setup's
// networkidle wait hangs on the pending request). The live check is the one deliberate exception, and
// it still imports the shared `test`, opting out via `test.use({ liveSpots: true })`.
const E2E_DIR = path.resolve(__dirname, '../e2e');
const RAW_TEST_IMPORT = /import\s*\{[^}]*\btest\b[^}]*\}\s*from\s*['"]@playwright\/test['"]/;

describe('e2e specs use the spot-mocking test fixture', () => {
  const specs = fs.readdirSync(E2E_DIR).filter((f) => f.endsWith('.spec.ts'));

  it('finds the specs', () => {
    expect(specs.length).toBeGreaterThan(10);
  });

  it.each(specs)('%s imports test from ../fixtures/test.ts', (spec) => {
    const source = fs.readFileSync(path.join(E2E_DIR, spec), 'utf8');
    expect(source).not.toMatch(RAW_TEST_IMPORT);
  });

  it('only spots-live.spec.ts opts into live polling', () => {
    const optedIn = specs.filter((spec) => /liveSpots\s*:\s*true/.test(fs.readFileSync(path.join(E2E_DIR, spec), 'utf8')));
    expect(optedIn).toEqual(['spots-live.spec.ts']);
  });
});

import { spawnSync } from 'child_process';
import { createRequire } from 'module';

// `npm run test:e2e:live-spots` — the opt-in pre-release check that polls the REAL POTA/SOTA/WWFF
// APIs (tests/e2e/spots-live.spec.ts). A node wrapper rather than `VAR=1 playwright ...` in
// package.json so the env var works on Windows too. Run tests/e2e/reset-test-data.mjs first
// (the npm script does), same as test:e2e.
const require = createRequire(import.meta.url);
const cli = require.resolve('@playwright/test/cli');
const result = spawnSync(
  process.execPath,
  [cli, 'test', 'tests/e2e/spots-live.spec.ts', ...process.argv.slice(2)],
  { stdio: 'inherit', env: { ...process.env, RCW_E2E_LIVE_SPOTS: '1' } },
);
process.exit(result.status ?? 1);

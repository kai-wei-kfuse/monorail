// Run the exact npm check stages through their real JS entrypoints.
// This workspace has no node_modules/.bin directory or Windows .cmd shims;
// npm run check surfaces "tsc is not recognized" before executing any stage.
import { spawnSync } from 'node:child_process';
const stages = [
  ['version', 'scripts/version.mjs', '--check'],
  ['typescript', 'node_modules/typescript/bin/tsc', '--noEmit'],
  ['mcp-typescript', 'node_modules/typescript/bin/tsc', '--noEmit', '-p', 'mcp/tsconfig.json'],
  ['eslint', 'node_modules/eslint/bin/eslint.js', 'src', 'client', 'cli', 'mcp'],
  // test-runner.mjs enforces the repository's 60-second full backend process deadline.
  ['vitest', 'test-runner.mjs'],
  ['mcp-cli-build', 'scripts/build-mcp.mjs'],
  ['mcp-smoke', '--test', '--test-timeout=60000', 'mcp/compatibility.test.ts', 'mcp/windowsLauncher.test.ts'],
  ['cli-smoke', '--test', '--test-timeout=60000', 'cli/cli.test.ts'],
  ['release-tooling', '--experimental-test-module-mocks', '--test', '--test-timeout=60000', 'scripts/publish-release.test.mjs', 'scripts/verify-release-recovery.test.mjs'],
];
for (const [name, ...args] of stages) {
  console.log(`CHECK ${name}`);
  const result = spawnSync(process.execPath, args, { stdio: 'inherit', env: { ...process.env, TZ:'Asia/Shanghai' } });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${name} failed: code=${result.status}, signal=${result.signal}`);
  console.log(`PASS ${name}`);
}

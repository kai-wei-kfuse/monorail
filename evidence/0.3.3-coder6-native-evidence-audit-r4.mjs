import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listTargetsWithLabels } from './0.3.3-isolated/lib.mjs';

const evidence = dirname(fileURLToPath(import.meta.url));
const repo = join(evidence, '..');
const native = join(evidence, '0.3.3-isolated');
const readJson = name => JSON.parse(readFileSync(join(native, name), 'utf8'));
const digest = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const before = readJson('baseline-before.json');
const after = readJson('baseline-after-p7.json');
const env = readJson('env.json');
const result = readJson('results-p7.json');

// Compare saved evidence only; do not operate any running application or data directory.
const baselineComparison = {
  runSame: JSON.stringify(before.run) === JSON.stringify(after.run),
  dailyExeSame: before.daily.exeSha256 === after.daily.exeSha256,
  dailyConfigSame: before.daily.configSha256 === after.daily.configSha256,
  dailyProcessUntouched: JSON.stringify(before.daily.processes) === JSON.stringify(after.daily.processes),
};
assert.deepEqual(baselineComparison, result.baselineComparison);
assert.equal(Object.keys(result.matrix).length, 7);
assert.equal(
  Object.values(result.matrix).every(item => item.passed === true) &&
    Object.values(baselineComparison).every(value => value === true),
  result.allPassed,
);

// Controlled transport failure: an unavailable CDP endpoint must not count as a closed window.
const originalFetch = globalThis.fetch;
let failedCdpProbe;
try {
  globalThis.fetch = async () => { throw new Error('CODER6_CONTROLLED_CDP_UNAVAILABLE'); };
  try {
    const targets = await listTargetsWithLabels(env.cdpPort);
    failedCdpProbe = {
      outcome: 'returned',
      targets,
      originalClosePredicateWouldPass: !targets.some(target => target.label === 'idea-audit-sentinel'),
    };
  } catch (error) {
    failedCdpProbe = { outcome: 'threw', message: String(error) };
  }
} finally {
  globalThis.fetch = originalFetch;
}

const files = [
  'src/services/ideaService.ts',
  'src/domain/record/record.ts',
  'src/platform/ideaWindows.ts',
  'src-tauri/src/idea_windows.rs',
  'src/app/IdeaWindowApp.tsx',
  'src/app/QuickBarApp.tsx',
  'evidence/0.3.3-coder6-api-review.test.ts',
  'evidence/0.3.3-coder6-api-review-r4.log',
  'evidence/0.3.3-coder6-window-interop-review.test.ts',
  'evidence/0.3.3-coder6-window-interop-review-r4.log',
  'evidence/0.3.3-isolated/setup.mjs',
  'evidence/0.3.3-isolated/lib.mjs',
  'evidence/0.3.3-isolated/run-p7-native.mjs',
  'evidence/0.3.3-isolated/results-p7.json',
  'evidence/0.3.3-isolated/baseline-before.json',
  'evidence/0.3.3-isolated/baseline-after-p7.json',
];
const sourceAndEvidenceHashes = Object.fromEntries(files.map(file => [file, digest(join(repo, file))]));
const artifacts = Object.fromEntries(['exe', 'cli', 'mcp', 'config'].map(key => [key, {
  path: env[key],
  sha256: digest(env[key]),
  lastWriteTimeUtc: statSync(env[key]).mtime.toISOString(),
}]));
const report = {
  at: new Date().toISOString(),
  command: 'node evidence/0.3.3-coder6-native-evidence-audit-r4.mjs',
  methodology: 'Read-only audit of saved P7 artifacts; controlled failed-fetch probe; not a rerun of OS windows.',
  baselineComparison,
  matrixKeys: Object.keys(result.matrix),
  failedCdpProbe,
  artifacts,
  historicalBuildBinding: 'Contemporaneous artifact hashes only: results-p7.json did not bind its execution to these hashes.',
  sourceAndEvidenceHashes,
};
writeFileSync(join(evidence, '0.3.3-coder6-native-evidence-audit-r4.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));

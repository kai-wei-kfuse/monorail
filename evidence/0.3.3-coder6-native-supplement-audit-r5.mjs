import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const evidence = dirname(fileURLToPath(import.meta.url));
const repo = join(evidence, '..');
const native = join(evidence, '0.3.3-isolated');
const readJson = path => JSON.parse(readFileSync(path, 'utf8'));
const digest = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const result = readJson(join(native, 'results-p7-supplement.json'));
const before = readJson(join(native, 'baseline-before.json'));
const after = readJson(join(native, 'baseline-after-supplement.json'));
const r4 = readJson(join(evidence, '0.3.3-coder6-native-evidence-audit-r4.json'));
const baselineComparison = {
  runSame: JSON.stringify(before.run) === JSON.stringify(after.run),
  dailyExeSame: before.daily.exeSha256 === after.daily.exeSha256,
  dailyConfigSame: before.daily.configSha256 === after.daily.configSha256,
  dailyProcessUntouched: JSON.stringify(before.daily.processes) === JSON.stringify(after.daily.processes),
};
assert.deepEqual(baselineComparison, result.baselineComparison);
assert.equal(Object.keys(result.items).length, 3);
assert.equal(result.allPassed, Object.values(result.items).every(item => item.passed === true) &&
  Object.values(baselineComparison).every(value => value === true));

const artifactMatches = Object.fromEntries(Object.entries(result.buildAndArtifactBindings)
  .filter(([key]) => key.startsWith('isolated'))
  .map(([key, artifact]) => {
    assert.equal(digest(artifact.path), artifact.sha256, `${key} SHA256 differs`);
    assert.equal(statSync(artifact.path).size, artifact.sizeBytes, `${key} size differs`);
    return [key, { sha256: artifact.sha256, matches: true }];
  }));
const sourceMatches = Object.fromEntries(Object.entries(result.buildAndArtifactBindings.sourceHashes)
  .map(([path, expected]) => {
    assert.equal(digest(join(repo, path)), expected, `${path} SHA256 differs`);
    return [path, { sha256: expected, matches: true }];
  }));
const historicalP7Preserved = Object.fromEntries([
  'evidence/0.3.3-isolated/results-p7.json',
  'evidence/0.3.3-isolated/baseline-after-p7.json',
].map(path => {
  assert.equal(digest(join(repo, path)), r4.sourceAndEvidenceHashes[path]);
  return [path, true];
}));

function hashDirectory(root) {
  const hashes = {};
  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile()) hashes[relative(root, path).replace(/\\/g, '/')] = digest(path);
    }
  }
  walk(root);
  return hashes;
}

const old = result.items.old032ExeRejectsV3AndRestoresV2Backup;
assert.deepEqual(old.v3HashesBefore032Open, old.v3HashesAfter032Open);
const currentV3Hashes = hashDirectory(old.v3DrillDir);
assert.deepEqual(currentV3Hashes, old.v3HashesAfter032Open);
const recordPath = 'records/11111111-2222-4333-8444-555555555555.md';
const backupRoot = join(old.v3DrillDir, old.backupRelativePath);
const restoredRecordMatchesBackup = digest(join(backupRoot, recordPath)) ===
  digest(join(old.v2RestoredDrillDir, recordPath));
assert.equal(restoredRecordMatchesBackup, true);
assert.equal(digest(join(backupRoot, 'timelog/2026-10-01.md')),
  digest(join(old.v2RestoredDrillDir, 'timelog/2026-10-01.md')));
assert.match(readFileSync(join(old.v2RestoredDrillDir, 'state.yaml'), 'utf8'), /schemaVersion:\s*2/);
assert.match(readFileSync(join(old.v2RestoredDrillDir, 'settings.yaml'), 'utf8'), /schemaVersion:\s*2/);

const audit = {
  at: new Date().toISOString(),
  command: 'node evidence/0.3.3-coder6-native-supplement-audit-r5.mjs',
  methodology: 'Read-only saved-artifact and drill-directory verification; not an independent OS rerun.',
  artifactMatches,
  sourceMatches,
  historicalP7Preserved,
  baselineComparison,
  v3ManifestFileCount: Object.keys(currentV3Hashes).length,
  currentV3ManifestMatchesRecordedAfter: true,
  restoredRecordMatchesBackup,
  restoredHistoricalTimelogMatchesBackup: true,
  restoredStateAndSettingsSchema2: true,
  observedWmCloseTargetCounts: Object.fromEntries(Object.entries(result.items.osCloseDirtyThreeChoicesAndCleanCopy.wmCloseTargets)
    .map(([key, targets]) => [key, targets.length])),
  implementationAcceptance: 'N1/N2 targeted tests passed; M1 maintenance request/target correlation remains blocked by lead ruling.',
};
writeFileSync(join(evidence, '0.3.3-coder6-native-supplement-audit-r5.json'), `${JSON.stringify(audit, null, 2)}\n`);
console.log(JSON.stringify(audit, null, 2));

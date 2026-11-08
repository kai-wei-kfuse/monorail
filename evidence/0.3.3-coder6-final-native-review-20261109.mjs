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
const result = readJson(join(native, 'results-p7-final-coder-20261109.json'));
assert.deepEqual(result, readJson(join(native, 'results-p7-m1-final-coder-20261109.json')));
const frozen = readJson(join(evidence, '0.3.3-coder6-d1-reviewed-baseline-r8.json'));
const before = readJson(join(native, 'baseline-before-final-coder-20261109.json'));
const after = readJson(join(native, 'baseline-after-final-coder-20261109.json'));
const baselineComparison = {
  runSame: JSON.stringify(before.run) === JSON.stringify(after.run),
  dailyExeSame: before.daily.exeSha256 === after.daily.exeSha256,
  dailyConfigSame: before.daily.configSha256 === after.daily.configSha256,
  dailyProcessUntouched: JSON.stringify(before.daily.processes) === JSON.stringify(after.daily.processes),
};
assert.deepEqual(baselineComparison, result.baselineComparison);
assert.ok(Object.values(baselineComparison).every(value => value === true));

const bindings = result.buildAndArtifactBindings;
const sourceHashes = bindings.sourceHashes;
assert.equal(Object.keys(sourceHashes).length, 16);
for (const [path, sha] of Object.entries(sourceHashes)) assert.equal(digest(join(repo, path)), sha, path);
const frozenSources = Object.entries(frozen.sourceAndEvidenceHashes).filter(([path]) => path.startsWith('src/'))
  .concat(Object.entries(frozen.sourceAndEvidenceHashes).filter(([path]) => path.startsWith('src-tauri/')));
assert.equal(frozenSources.length, 10);
for (const [path, sha] of frozenSources) assert.equal(sourceHashes[path], sha, `frozen ${path}`);
for (const key of ['isolated033Exe', 'isolated033Cli', 'isolated033Mcp', 'isolated032Exe']) {
  const artifact = bindings[key];
  assert.equal(digest(artifact.path), artifact.sha256, key);
  assert.equal(statSync(artifact.path).size, artifact.sizeBytes, `${key} size`);
}
assert.equal(bindings.isolated033Exe.sha256, '089cbfa9e93059cfa768662c5fcac561f74a0d21bf4db664a739660cba6b214b');

const os = result.items.osCloseDirtyThreeChoicesAndCleanCopy;
const expectedCloseDetails = '## OS 级窗口关闭三选实测\n- 触发真实 Win32 WM_CLOSE / CloseRequested 事件';
assert.equal(os.draftAfterContinue, expectedCloseDetails);
assert.equal(os.persistedAfterSaveClose, expectedCloseDetails);
assert.equal(os.persistedAfterDiscardClose, expectedCloseDetails);
for (const close of [os.closeCheckAfterSave, os.closeCheckAfterDiscard]) {
  assert.equal(close.closed, true);
  assert.equal(close.mainAlive, true);
  assert.ok(close.remainingLabels.includes('main'));
}
for (const targets of Object.values(os.wmCloseTargets)) assert.ok(targets.some(target => target.includes('想法笔记')));

const exit = result.items.realExitBlockedThenSaveThenCleanExit;
assert.equal(exit.missingTokenReject.rejected, true);
assert.equal(exit.emptyTokenReject.rejected, true);
assert.equal(exit.processAliveAfterBlockedExit, true);
assert.equal(exit.mainToastCheckAfterBlockedExit.hasDirtyBlockMessage, true);
for (const key of ['hasSpuriousNoPendingError', 'hasSpuriousExpiredError', 'hasSpuriousMissingTokenError']) {
  assert.equal(exit.mainToastCheckAfterBlockedExit[key], false, key);
}
assert.equal(exit.ideaStateAfterBlockedExit.titleDisabled, false);
assert.equal(exit.ideaStateAfterBlockedExit.detailsDisabled, false);
assert.equal(exit.ideaStateAfterBlockedExit.detailsValue,
  '## 真实退出处理链（app-exit-requested）拦截后保存再退出\n- 仅修改正文，未改动标题');
assert.deepEqual(exit.cleanExitOutcome, { code: 0, signal: null });

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
for (const key of ['activeJournalFilesAfterCleanMigration', 'activeJournalFilesBefore032Open', 'activeJournalFilesAfter032Open']) {
  assert.equal(old[key], 0, key);
}
assert.deepEqual(old.v3HashesBefore032Open, old.v3HashesAfter032Open);
assert.deepEqual(hashDirectory(old.v3DrillDir), old.v3HashesAfter032Open);
assert.equal(Object.keys(old.v3HashesAfter032Open).length, 12);
const backupRoot = join(old.v3DrillDir, old.backupRelativePath);
for (const path of ['records/11111111-2222-4333-8444-555555555555.md', 'timelog/2026-10-01.md']) {
  assert.equal(digest(join(old.v2RestoredDrillDir, path)), digest(join(backupRoot, path)), `restored ${path}`);
}
assert.match(readFileSync(join(old.v2RestoredDrillDir, 'state.yaml'), 'utf8'), /schemaVersion:\s*2/);
assert.match(readFileSync(join(old.v2RestoredDrillDir, 'settings.yaml'), 'utf8'), /schemaVersion:\s*2/);
assert.equal(old.migratedIdeaDetails, '\n第二行自动拆入v3详情正文\n- 第三行列表项保留\n');
assert.equal(old.restoredBodyShowsV2Idea, true);
assert.equal(Object.keys(result.items).length, 3);
assert.ok(Object.values(result.items).every(item => item.passed === true));
assert.equal(result.allPassed, true);

const r4 = readJson(join(evidence, '0.3.3-coder6-native-evidence-audit-r4.json'));
for (const path of ['evidence/0.3.3-isolated/results-p7.json', 'evidence/0.3.3-isolated/baseline-after-p7.json']) {
  assert.equal(digest(join(repo, path)), r4.sourceAndEvidenceHashes[path], `preserved ${path}`);
}
const history = join(native, 'history-before-final-20261109');
for (const name of ['results-p7-supplement.json', 'results-p7-m1-reverify.json', 'baseline-after-supplement.json']) {
  assert.equal(digest(join(native, name)), digest(join(history, name)), `history ${name}`);
}

const audit = {
  at: new Date().toISOString(),
  command: 'node evidence/0.3.3-coder6-final-native-review-20261109.mjs',
  methodology: 'Independent read-only saved-artifact, source and drill-directory review; native execution was performed by coder.',
  exeSha256: bindings.isolated033Exe.sha256,
  artifactCountVerified: 4,
  sourceCountVerified: 16,
  frozenSourceCountVerified: 10,
  nativeItemCountVerified: 3,
  duplicateResultFilesAreOneRun: true,
  baselineComparison,
  v3ManifestFileCount: 12,
  restoredRecordAndHistoricalTimelogMatchBackup: true,
  historicalP7AndPreFinalOutputsPreserved: true,
  finalResultSha256: digest(join(native, 'results-p7-final-coder-20261109.json')),
  finalScriptSha256: digest(join(native, 'run-p7-final-coder-20261109.mjs')),
  conclusion: 'Final native evidence matches the reviewed frozen source and supports the three reported acceptance paths.',
};
writeFileSync(join(evidence, '0.3.3-coder6-final-native-review-20261109.json'), `${JSON.stringify(audit, null, 2)}\n`);
console.log(JSON.stringify(audit, null, 2));

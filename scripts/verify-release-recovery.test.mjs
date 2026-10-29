import assert from 'node:assert/strict';
import { test } from 'node:test';

const validation = 'a'.repeat(40), tagged = 'b'.repeat(40);
const cases = [
  { name: 'accepts test and release-tool changes', paths: ['src/app/readoutRegression.test.ts', 'scripts/publish-release.mjs'] },
  { name: 'rejects a changed product source', paths: ['src/pages/home/timer.css'], error: /changes tagged product files/ },
  { name: 'rejects publishing from a recovery build', publish: 'true', error: /requires publish=false/ },
  { name: 'rejects an unpinned validation ref', ref: 'master', error: /full commit SHA/ },
  { name: 'rejects a different checked-out commit', checkout: tagged, error: /differs from validation_ref/ },
];
for (const [index, scenario] of cases.entries()) {
  test(scenario.name, async t => {
    const commands = [];
    t.mock.module('node:child_process', { namedExports: {
      execFileSync: (command, args) => {
        assert.equal(command, 'git');
        commands.push(args);
        if (args[0] === 'rev-parse' && args.at(-1) === 'HEAD^{commit}') return scenario.checkout ?? validation;
        if (args[0] === 'rev-parse' && args.at(-1) === 'v0.2.2^{commit}') return tagged;
        if (args[0] === 'diff') return (scenario.paths ?? []).join('\0') + '\0';
        throw new Error(`Unexpected git arguments: ${args.join(' ')}`);
      },
    } });
    const previousArgv = process.argv;
    t.after(() => { process.argv = previousArgv; });
    process.argv = [process.execPath, 'verify-release-recovery.mjs', 'v0.2.2', scenario.ref ?? validation, scenario.publish ?? 'false'];
    const run = import(`./verify-release-recovery.mjs?case=${index}`);
    if (scenario.error) await assert.rejects(run, scenario.error);
    else {
      await run;
      const diff = commands.find(args => args[0] === 'diff');
      assert.ok(diff.includes('--no-renames'));
      assert.ok(diff.includes('-z'));
      assert.deepEqual(diff.slice(-3), [tagged, validation, '--']);
    }
  });
}

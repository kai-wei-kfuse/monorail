import { execFileSync } from 'node:child_process';

const [tag, validationRef, publish] = process.argv.slice(2);
if (publish !== 'false') throw new Error('Recovery validation requires publish=false');
if (!/^[0-9a-f]{40}$/.test(validationRef ?? '')) throw new Error('validation_ref must be a full commit SHA');
const git = args => execFileSync('git', args, { encoding: 'utf8' });
const validated = git(['rev-parse', '--verify', 'HEAD^{commit}']).trim();
if (validated !== validationRef) throw new Error('Checked-out validation commit differs from validation_ref');
const tagged = git(['rev-parse', '--verify', '--end-of-options', `${tag}^{commit}`]).trim();
const allowed = new Set([
  '.github/workflows/release.yml', 'src/app/readoutRegression.test.ts', 'docs/updates.md',
  'scripts/publish-release.mjs', 'scripts/publish-release.test.mjs',
  'scripts/verify-release-recovery.mjs', 'scripts/verify-release-recovery.test.mjs',
]);
const changed = git(['diff', '--no-renames', '--name-only', '-z', tagged, validated, '--']).split('\0').filter(Boolean);
const unexpected = changed.filter(path => !allowed.has(path));
if (unexpected.length) throw new Error(`Validation commit changes tagged product files: ${unexpected.join(', ')}`);
console.log(`Validated ${validated}; signed build will use tagged commit ${tagged}`);

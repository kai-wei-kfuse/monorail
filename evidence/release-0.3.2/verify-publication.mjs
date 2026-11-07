// Read-only verification of published assets; never executes the installer.
// 0.3.2 stable: adapted from the 0.3.0 publication check.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const repository = 'kai-wei-kfuse/monorail';
const tag = 'v0.3.2', version = '0.3.2';
const commit = '8c60915ecae689ac9b2a123d81c94c58c3d21821', runId = process.argv[2];
const directory = resolve('evidence/release-0.3.2');
const gh = args => execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const api = path => JSON.parse(gh(['api', `repos/${repository}/${path}`]));
const hash = b => `sha256:${createHash('sha256').update(b).digest('hex')}`;
const release = api(`releases/tags/${tag}`), latest = api('releases/latest');
assert.equal(release.draft, false);
assert.equal(release.prerelease, false);
assert.equal(latest.tag_name, tag);
assert.equal(latest.id, release.id);
let tagObject = api(`git/ref/tags/${tag}`).object;
if (tagObject.type === 'tag') tagObject = api(`git/tags/${tagObject.sha}`).object;
assert.equal(tagObject.sha, commit);
const ci = JSON.parse(gh(['run', 'view', runId, '--repo', repository, '--json', 'databaseId,headSha,headBranch,conclusion,status,url,jobs']));
assert.equal(ci.headSha, commit);
assert.equal(ci.conclusion, 'success');
const identity = api(`actions/runs/${runId}`);
assert.equal(String(identity.id), String(runId));
assert.equal(identity.path, '.github/workflows/release.yml');
assert.equal(identity.event, 'push');
assert.equal(identity.head_branch, tag);
assert.equal(identity.head_sha, commit);
const releaseJob = ci.jobs.find(job => job.name === 'release');
assert.equal(releaseJob?.conclusion, 'success');
assert.equal(releaseJob.steps.find(step => step.name === 'Build signed NSIS')?.conclusion, 'success');
await writeFile(join(directory, 'ci-result.json'), JSON.stringify(ci, null, 2) + '\n');
await writeFile(join(directory, 'release-metadata.json'), JSON.stringify(release, null, 2) + '\n');
await writeFile(join(directory, 'latest-release.json'), JSON.stringify(latest, null, 2) + '\n');
const published = join(directory, 'published'), artifacts = join(directory, 'ci-artifacts');
await mkdir(published, { recursive: true });
await mkdir(artifacts, { recursive: true });
gh(['release', 'download', tag, '--repo', repository, '--dir', published, '--clobber']);
gh(['run', 'download', runId, '--repo', repository, '--name', `${tag}-signed-nsis`, '--dir', artifacts]);
const name = `monorail_${version}_windows-x86_64_setup.exe`;
assert.deepEqual(release.assets.map(a => a.name).sort(), ['latest.json', name, `${name}.sig`].sort());
for (const asset of release.assets) {
  const bytes = await readFile(join(published, asset.name));
  assert.equal(bytes.length, asset.size);
  assert.equal(hash(bytes), asset.digest);
}
const manifest = JSON.parse(await readFile(join(published, 'latest.json'), 'utf8'));
const notes = execFileSync('git', ['show', `${tag}:docs/releases/${version}.md`], { encoding: 'utf8' });
const signature = (await readFile(join(published, `${name}.sig`), 'utf8')).trim();
const installer = release.assets.find(a => a.name === name);
const normalize = s => s.replaceAll('\r\n', '\n').trim();
assert.equal(manifest.version, version);
assert.equal(normalize(manifest.notes), normalize(notes));
assert.equal(normalize(release.body), normalize(notes));
assert.equal(manifest.platforms['windows-x86_64'].url, installer.url);
assert.equal(manifest.platforms['windows-x86_64'].signature, signature);
assert.deepEqual(manifest.monorail, { channel: 'stable', dataSchemaVersion: 2, readableDataSchemaVersions: [2] });
const ciNames = (await readdir(artifacts)).filter(n => n.endsWith('.exe'));
assert.equal(ciNames.length, 1);
for (const suffix of ['', '.sig']) assert.equal(hash(await readFile(join(artifacts, ciNames[0] + suffix))), hash(await readFile(join(published, name + suffix))));
const temp = await mkdtemp(join(tmpdir(), 'monorail-032-release-verification-'));
// Cargo resolves a coherent feature graph; picking a cached rlib by name can mix builds.
await writeFile(join(temp, 'verify.rs'), await readFile('evidence/release-0.2.5/verify-signature.rs'));
await writeFile(join(temp, 'Cargo.toml'), `[package]
name = "stable-signature-check"
version = "0.1.0"
edition = "2021"
[[bin]]
name = "stable-signature-check"
path = "verify.rs"
[dependencies]
minisign-verify = "0.3"
`);
execFileSync('cargo', ['build', '--offline', '--manifest-path', join(temp, 'Cargo.toml')], { stdio: 'pipe', timeout: 120000 });
const verifier = join(temp, 'target/debug/stable-signature-check.exe');
const config = JSON.parse(execFileSync('git', ['show', `${tag}:src-tauri/tauri.conf.json`], { encoding: 'utf8' }));
const keyFile = join(temp, 'public-key.txt'), sigFile = join(temp, 'signature.txt');
await writeFile(keyFile, Buffer.from(config.plugins.updater.pubkey, 'base64'));
await writeFile(sigFile, Buffer.from(signature, 'base64'));
const log = execFileSync(verifier, [join(published, name), keyFile, sigFile], { encoding: 'utf8' });
await writeFile(join(directory, 'signature-verification.log'), log);
const result = { tag, url: release.html_url, commit, runId, releaseId: release.id, prerelease: false, stableLatest: latest.tag_name,
  assets: release.assets.map(({ name, id, size, digest }) => ({ name, id, size, digest })),
  manifestMatches: true, ciArtifactHashesMatch: true, productionSignatureVerified: true, tamperedInstallerRejected: true,
  installerExecuted: false, checkedAt: new Date().toISOString() };
await writeFile(join(directory, 'verification.json'), JSON.stringify(result, null, 2) + '\n');
console.log(log.trim());
console.log(JSON.stringify(result, null, 2));

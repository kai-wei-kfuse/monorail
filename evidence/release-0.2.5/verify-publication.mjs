// Verify the published bytes and signed CI artifact. Does not run the installer or touch user data.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';

const repository = 'kai-wei-kfuse/monorail', tag = 'v0.2.5';
const commit = '3f5ac0a23456ef8ca05112668ae41e578e916ff2', runId = '41317545621';
const directory = resolve('evidence/release-0.2.5');
const gh = args => execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const api = path => JSON.parse(gh(['api', `repos/${repository}/${path}`]));
const digest = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const release = api(`releases/tags/${tag}`), latest = api('releases/latest');
assert.equal(release.draft, false);
assert.equal(release.prerelease, false);
assert.equal(latest.id, release.id);
assert.equal(api(`git/ref/tags/${tag}`).object.sha, commit);
const ci = JSON.parse(gh(['run', 'view', runId, '--repo', repository, '--json', 'databaseId,headSha,headBranch,conclusion,status,url,jobs']));
assert.equal(ci.headSha, commit);
assert.equal(ci.status, 'completed');
assert.equal(ci.conclusion, 'success');
await writeFile(join(directory, 'ci-result.json'), JSON.stringify(ci, null, 2) + '\n');
await writeFile(join(directory, 'release-metadata.json'), JSON.stringify(release, null, 2) + '\n');
await writeFile(join(directory, 'latest-release.json'), JSON.stringify(latest, null, 2) + '\n');

const published = join(directory, 'published'), artifacts = join(directory, 'ci-artifacts');
await mkdir(published, { recursive: true });
await mkdir(artifacts, { recursive: true });
gh(['release', 'download', tag, '--repo', repository, '--dir', published]);
gh(['run', 'download', runId, '--repo', repository, '--name', `${tag}-signed-nsis`, '--dir', artifacts]);
const installerName = 'monorail_0.2.5_windows-x86_64_setup.exe';
assert.deepEqual(release.assets.map(asset => asset.name).sort(), ['latest.json', installerName, `${installerName}.sig`].sort());
for (const asset of release.assets) {
  const bytes = await readFile(join(published, asset.name));
  assert.equal(bytes.length, asset.size, `Asset size: ${asset.name}`);
  assert.equal(digest(bytes), asset.digest, `GitHub digest: ${asset.name}`);
}
const manifest = JSON.parse(await readFile(join(published, 'latest.json'), 'utf8'));
const notes = await readFile('docs/releases/0.2.5.md', 'utf8');
const signature = (await readFile(join(published, `${installerName}.sig`), 'utf8')).trim();
const installer = release.assets.find(asset => asset.name === installerName);
assert.equal(manifest.version, '0.2.5');
// Git checkout on Windows may use CRLF; compare the actual note text with normalized line endings.
assert.equal(manifest.notes.replaceAll('\r\n', '\n'), notes.replaceAll('\r\n', '\n'));
assert.equal(release.body.replaceAll('\r\n', '\n').trim(), notes.replaceAll('\r\n', '\n').trim());
assert.equal(manifest.platforms['windows-x86_64'].url, installer.url);
assert.equal(manifest.platforms['windows-x86_64'].signature, signature);
const ciInstallerNames = (await readdir(artifacts)).filter(name => name.endsWith('.exe'));
assert.equal(ciInstallerNames.length, 1);
for (const suffix of ['', '.sig']) {
  assert.equal(digest(await readFile(join(artifacts, ciInstallerNames[0] + suffix))), digest(await readFile(join(published, installerName + suffix))));
}
const verifierRoot = join(tmpdir(), 'monorail-025-release-verification');
const config = JSON.parse(await readFile('src-tauri/tauri.conf.json', 'utf8'));
const publicKey = join(verifierRoot, 'public-key.txt'), decodedSignature = join(verifierRoot, 'signature.txt');
await writeFile(publicKey, Buffer.from(config.plugins.updater.pubkey, 'base64'));
await writeFile(decodedSignature, Buffer.from(signature, 'base64'));
const verificationLog = execFileSync(join(verifierRoot, 'verify-signature.exe'), [join(published, installerName), publicKey, decodedSignature], { encoding: 'utf8' });
await writeFile(join(directory, 'signature-verification.log'), verificationLog);
const result = { tag, url: release.html_url, releaseId: release.id, publishedAt: release.published_at, commit,
  ciUrl: ci.url, assets: release.assets.map(({ name, id, size, digest }) => ({ name, id, size, digest })),
  manifestVersion: manifest.version, notesMatch: true, manifestSignatureMatches: true, ciArtifactHashesMatch: true,
  signatureAndTrustedCommentVerified: true, tamperedInstallerRejected: true, isLatest: true,
  installed: false, checkedAt: new Date().toISOString() };
await writeFile(join(directory, 'verification.json'), JSON.stringify(result, null, 2) + '\n');
console.log(verificationLog.trim());
console.log(JSON.stringify(result, null, 2));

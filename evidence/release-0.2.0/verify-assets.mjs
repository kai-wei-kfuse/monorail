import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const [directory, metadataPath] = process.argv.slice(2);
assert(directory && metadataPath, 'usage: verify-assets.mjs <download-directory> <release-api.json>');
const release = JSON.parse(await readFile(metadataPath, 'utf8'));
assert.equal(release.tag_name, 'v0.2.0');
assert.equal(release.draft, false);
assert.equal(release.prerelease, false);
const installerName = 'monorail_0.2.0_windows-x86_64_setup.exe';
const assets = [];
for (const name of [installerName, `${installerName}.sig`, 'latest.json']) {
  const metadata = release.assets.find(asset => asset.name === name);
  assert(metadata, `missing release asset: ${name}`);
  const bytes = await readFile(join(directory, name));
  const digest = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
  assert.equal(bytes.length, metadata.size, `asset size: ${name}`);
  assert.equal(digest, metadata.digest, `asset SHA256: ${name}`);
  assets.push({ name, id: metadata.id, size: bytes.length, digest });
}
const manifest = JSON.parse(await readFile(join(directory, 'latest.json'), 'utf8'));
const signature = (await readFile(join(directory, `${installerName}.sig`), 'utf8')).trim();
const notes = await readFile('docs/releases/0.2.0.md', 'utf8');
assert.equal(manifest.version, '0.2.0');
assert.equal(manifest.notes.trim(), notes.trim());
assert.equal(release.body.trim(), notes.trim());
assert.equal(manifest.platforms['windows-x86_64'].signature, signature);
assert.equal(manifest.platforms['windows-x86_64'].url, release.assets.find(asset => asset.name === installerName).url);
const config = JSON.parse(await readFile('src-tauri/tauri.conf.json', 'utf8'));
const keyLines = Buffer.from(config.plugins.updater.pubkey, 'base64').toString('utf8').trim().split(/\r?\n/);
const signatureLines = Buffer.from(signature, 'base64').toString('utf8').trim().split(/\r?\n/);
const keyId = Buffer.from(keyLines[1], 'base64').subarray(2, 10);
const signatureKeyId = Buffer.from(signatureLines[1], 'base64').subarray(2, 10);
assert.deepEqual(keyId, signatureKeyId, 'signature public key ID');
console.log(JSON.stringify({
  tag: release.tag_name, releaseUrl: release.html_url, releaseId: release.id,
  publishedAt: release.published_at, draft: release.draft, prerelease: release.prerelease,
  assets, manifestVersion: manifest.version, manifestInstallerUrlMatches: true,
  manifestSignatureMatches: true, releaseNotesMatch: true, publicKeyIdMatches: true,
  publicKeyIdHex: keyId.toString('hex'),
}, null, 2));

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const [directory, metadataPath] = process.argv.slice(2);
if (!directory || !metadataPath) throw new Error('Expected download directory and release metadata');
const release = JSON.parse(await readFile(metadataPath, 'utf8'));
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const config = JSON.parse(await readFile('src-tauri/tauri.conf.json', 'utf8'));
const name = 'monorail_' + pkg.version + '_windows-x86_64_setup.exe';
assert.equal(release.tag_name, 'v' + pkg.version);
assert.equal(release.draft, false);
assert.equal(release.prerelease, false);
const assets = [];
for (const filename of [name, name + '.sig', 'latest.json']) {
  const matches = release.assets.filter(asset => asset.name === filename);
  assert.equal(matches.length, 1, 'asset count: ' + filename);
  const asset = matches[0], bytes = await readFile(join(directory, filename));
  const digest = 'sha256:' + createHash('sha256').update(bytes).digest('hex');
  assert.equal(bytes.length, asset.size, 'asset size: ' + filename);
  assert.equal(digest, asset.digest, 'asset digest: ' + filename);
  assets.push({ name: filename, id: asset.id, size: bytes.length, digest });
}
const manifest = JSON.parse(await readFile(join(directory, 'latest.json'), 'utf8'));
const signature = (await readFile(join(directory, name + '.sig'), 'utf8')).trim();
const notes = await readFile('docs/releases/' + pkg.version + '.md', 'utf8');
const normalize = text => text.replace(/\r\n/g, '\n').trim();
assert.equal(manifest.version, pkg.version);
assert.equal(normalize(manifest.notes), normalize(notes));
assert.equal(normalize(release.body), normalize(notes));
assert.equal(manifest.platforms['windows-x86_64'].signature, signature);
assert.equal(manifest.platforms['windows-x86_64'].url, release.assets.find(asset => asset.name === name).url);
const keyLines = Buffer.from(config.plugins.updater.pubkey, 'base64').toString('utf8').trim().split(/\r?\n/);
const sigLines = Buffer.from(signature, 'base64').toString('utf8').trim().split(/\r?\n/);
assert.deepEqual(Buffer.from(keyLines[1], 'base64').subarray(2, 10), Buffer.from(sigLines[1], 'base64').subarray(2, 10));
console.log(JSON.stringify({ tag: release.tag_name, url: release.html_url, releaseId: release.id, publishedAt: release.published_at, assets, manifestVersion: manifest.version, notesMatch: true, manifestSignatureMatches: true, publicKeyIdMatches: true }, null, 2));
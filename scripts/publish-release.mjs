import { execFileSync } from 'node:child_process';
import { copyFile, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: {
  tag: { type: 'string' }, installer: { type: 'string' }, notes: { type: 'string' }, prerelease: { type: 'boolean', default: false },
} });
if (!values.tag || !values.installer || !values.notes) throw new Error('Required: --tag --installer --notes [--prerelease]');
const config = JSON.parse(await readFile('src-tauri/tauri.conf.json', 'utf8'));
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const repository = config.plugins.privateUpdater.repository;
const gh = args => execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const expectedTag = `${values.prerelease ? 'update-test-' : ''}v${pkg.version}`;
if (values.tag !== expectedTag) throw new Error(`Expected release tag ${expectedTag}`);
const taggedCommit = execFileSync('git', ['rev-parse', '--verify', `${values.tag}^{commit}`], { encoding: 'utf8' }).trim();
const installer = resolve(values.installer);
const signaturePath = installer + '.sig';
const signature = (await readFile(signaturePath, 'utf8')).trim();
if (!signature) throw new Error('Updater signature is empty');
const notes = await readFile(values.notes, 'utf8');
const directory = await mkdtemp(join(tmpdir(), 'monorail-release-'));
// GitHub normalizes non-ASCII asset names; stable ASCII names keep lookup deterministic.
const stagedInstaller = join(directory, `${values.prerelease ? 'monorail-update-test' : 'monorail'}_${pkg.version}_windows-x86_64_setup.exe`);
await copyFile(installer, stagedInstaller);
await copyFile(signaturePath, stagedInstaller + '.sig');
const args = ['release', 'create', values.tag, stagedInstaller, stagedInstaller + '.sig', '--repo', repository,
  '--title', `${values.prerelease ? '更新验收' : '单轨'} v${pkg.version}`, '--notes-file', resolve(values.notes), '--draft',
  '--target', taggedCommit, '--verify-tag'];
if (values.prerelease) args.push('--prerelease');
console.log(gh(args));
// The tag REST endpoint excludes draft releases; gh view provides the draft's numeric API URL.
const draft = JSON.parse(gh(['release', 'view', values.tag, '--repo', repository, '--json', 'apiUrl']));
const release = JSON.parse(gh(['api', draft.apiUrl]));
const asset = release.assets.find(asset => asset.name === basename(stagedInstaller));
if (!asset) throw new Error('Uploaded installer asset is missing');
const manifest = { version: pkg.version, notes, pub_date: new Date().toISOString(),
  platforms: { 'windows-x86_64': { url: asset.url, signature } } };
const manifestPath = join(directory, 'latest.json');
await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
console.log(gh(['release', 'upload', values.tag, manifestPath, '--repo', repository]));
console.log(gh(['release', 'edit', values.tag, '--repo', repository, '--draft=false', `--latest=${!values.prerelease}`]));
const published = JSON.parse(gh(['release', 'view', values.tag, '--repo', repository, '--json', 'url']));
console.log(`Published ${published.url}`);

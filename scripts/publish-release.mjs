import { execFileSync } from 'node:child_process';
import { copyFile, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { parseArgs } from 'node:util';

const STABLE_VERSION_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const BETA_VERSION_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-beta\.([1-9]\d*)$/;
const DATA_SCHEMA_VERSION = 3;
const READABLE_DATA_SCHEMA_VERSIONS = [2, DATA_SCHEMA_VERSION];

const { values } = parseArgs({
  options: {
    tag: { type: 'string' },
    installer: { type: 'string' },
    notes: { type: 'string' },
    prerelease: { type: 'boolean', default: false },
    'test-release': { type: 'boolean', default: false },
    channel: { type: 'string' },
  },
});

if (!values.tag || !values.installer || !values.notes) {
  throw new Error('Required: --tag --installer --notes [--channel stable|beta|update-test] [--prerelease] [--test-release]');
}

const config = JSON.parse(await readFile('src-tauri/tauri.conf.json', 'utf8'));
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const repository = config.plugins.privateUpdater.repository;
const gh = args => execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

const isBetaVersion = BETA_VERSION_RE.test(pkg.version);
const isStableVersion = STABLE_VERSION_RE.test(pkg.version);
if (!isBetaVersion && !isStableVersion) {
  throw new Error(`Unsupported product version "${pkg.version}": expected X.Y.Z or X.Y.Z-beta.N`);
}

let releaseChannel;
if (values['test-release'] || values.channel === 'update-test' || (values.prerelease && values.tag.startsWith('update-test-'))) {
  if (!isStableVersion) {
    throw new Error('update-test releases must use a base X.Y.Z package.json version');
  }
  releaseChannel = 'update-test';
} else if (isBetaVersion) {
  if (values.channel && values.channel !== 'beta') {
    throw new Error(`Channel "${values.channel}" conflicts with beta version ${pkg.version}`);
  }
  releaseChannel = 'beta';
} else {
  if (values.prerelease || (values.channel && values.channel !== 'stable')) {
    throw new Error(`Stable version ${pkg.version} cannot be published as prerelease or channel "${values.channel ?? 'prerelease'}"`);
  }
  releaseChannel = 'stable';
}

const expectedTag = releaseChannel === 'update-test' ? `update-test-v${pkg.version}` : `v${pkg.version}`;
if (values.tag !== expectedTag) {
  throw new Error(`Expected release tag ${expectedTag}, got ${values.tag}`);
}

const installerName = basename(values.installer);
const installerVersionMatch = installerName.match(/^(?:单轨(?:更新验收)?|monorail(?:-update-test)?)_(.+?)(?:_x64-setup|_windows-x86_64_setup)\.exe$/);
if (installerVersionMatch && installerVersionMatch[1] !== pkg.version) {
  throw new Error(`Installer filename version "${installerVersionMatch[1]}" does not match package.json version "${pkg.version}"`);
}

const isPrerelease = releaseChannel === 'beta' || releaseChannel === 'update-test';
const assetPrefix = releaseChannel === 'update-test' ? 'monorail-update-test' : 'monorail';
const releaseTitle = `${releaseChannel === 'update-test' ? '更新验收' : '单轨'} v${pkg.version}`;

const taggedCommit = execFileSync('git', ['rev-parse', '--verify', `${values.tag}^{commit}`], { encoding: 'utf8' }).trim();
const installer = resolve(values.installer);
const signaturePath = installer + '.sig';
const signature = (await readFile(signaturePath, 'utf8')).trim();
if (!signature) throw new Error('Updater signature is empty');
const notes = await readFile(values.notes, 'utf8');
const directory = await mkdtemp(join(tmpdir(), 'monorail-release-'));
// GitHub normalizes non-ASCII asset names; stable ASCII names keep lookup deterministic.
const stagedInstaller = join(directory, `${assetPrefix}_${pkg.version}_windows-x86_64_setup.exe`);
await copyFile(installer, stagedInstaller);
await copyFile(signaturePath, stagedInstaller + '.sig');

const args = [
  'release', 'create', values.tag, stagedInstaller, stagedInstaller + '.sig',
  '--repo', repository,
  '--title', releaseTitle,
  '--notes-file', resolve(values.notes),
  '--draft',
  '--target', taggedCommit,
  '--verify-tag',
];
if (isPrerelease) args.push('--prerelease');
console.log(gh(args));

// The tag REST endpoint excludes draft releases; gh view provides the draft's numeric API URL.
const draft = JSON.parse(gh(['release', 'view', values.tag, '--repo', repository, '--json', 'apiUrl']));
const release = JSON.parse(gh(['api', draft.apiUrl]));
const asset = release.assets.find(asset => asset.name === basename(stagedInstaller));
if (!asset) throw new Error('Uploaded installer asset is missing');

const manifest = {
  version: pkg.version,
  notes,
  pub_date: new Date().toISOString(),
  platforms: {
    'windows-x86_64': {
      url: asset.url,
      signature,
    },
  },
  monorail: {
    channel: releaseChannel,
    dataSchemaVersion: DATA_SCHEMA_VERSION,
    readableDataSchemaVersions: READABLE_DATA_SCHEMA_VERSIONS,
  },
};
const manifestPath = join(directory, 'latest.json');
await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
console.log(gh(['release', 'upload', values.tag, manifestPath, '--repo', repository]));
console.log(gh(['release', 'edit', values.tag, '--repo', repository, '--draft=false', `--latest=${!isPrerelease}`]));
const published = JSON.parse(gh(['release', 'view', values.tag, '--repo', repository, '--json', 'url']));
console.log(`Published ${published.url}`);

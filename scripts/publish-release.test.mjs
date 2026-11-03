import assert from 'node:assert/strict';
import { test } from 'node:test';

for (const isPrivate of [false, true]) {
  test(`publishes signed stable assets for a ${isPrivate ? 'private' : 'public'} repository using the existing tag`, async t => {
    const commands = [], writes = [];
    const repository = 'example/monorail', apiUrl = `https://api.github.com/repos/${repository}/releases/100`;
    const assetUrl = `https://api.github.com/repos/${repository}/releases/assets/42`;
    t.mock.module('node:child_process', { namedExports: {
      execFileSync: (command, args) => {
        commands.push([command, ...args]);
        if (command === 'git') return args.includes('HEAD') ? 'different-head' : 'tagged-commit';
        if (command !== 'gh') throw new Error(`Unexpected command: ${command}`);
        if (args[0] === 'api' && args[1] === `repos/${repository}`) return JSON.stringify({ private: isPrivate });
        if (args[0] === 'api' && args[1] === apiUrl) return JSON.stringify({ assets: [{ name: 'monorail_0.2.2_windows-x86_64_setup.exe', url: assetUrl }] });
        if (args[0] === 'release' && args[1] === 'view') return JSON.stringify(args.at(-1) === 'apiUrl' ? { apiUrl } : { url: 'https://github.com/example/monorail/releases/tag/v0.2.2' });
        if (args[0] === 'release' && ['create', 'upload', 'edit'].includes(args[1])) return 'ok';
        throw new Error(`Unexpected gh arguments: ${args.join(' ')}`);
      },
    } });
    t.mock.module('node:fs/promises', { namedExports: {
      readFile: async path => {
        if (path === 'src-tauri/tauri.conf.json') return JSON.stringify({ plugins: { privateUpdater: { repository } } });
        if (path === 'package.json') return JSON.stringify({ version: '0.2.2' });
        if (String(path).endsWith('.sig')) return 'signed-payload';
        if (path === 'release-notes.md') return 'Release notes';
        throw new Error(`Unexpected file: ${path}`);
      },
      copyFile: async () => {},
      mkdtemp: async () => 'test-release-directory',
      writeFile: async (path, text) => { writes.push([path, text]); },
    } });
    const previousArgv = process.argv;
    t.after(() => { process.argv = previousArgv; });
    process.argv = [process.execPath, 'publish-release.mjs', '--tag', 'v0.2.2', '--installer', 'setup.exe', '--notes', 'release-notes.md'];
    await import(`./publish-release.mjs?visibility=${isPrivate}`);
    const create = commands.find(args => args[0] === 'gh' && args[1] === 'release' && args[2] === 'create');
    assert.ok(create);
    assert.equal(create[create.indexOf('--target') + 1], 'tagged-commit');
    assert.ok(create.includes('--verify-tag'));
    assert.ok(!create.includes('--prerelease'));
    const manifest = JSON.parse(writes.find(([path]) => String(path).endsWith('latest.json'))[1]);
    assert.equal(manifest.version, '0.2.2');
    assert.deepEqual(manifest.platforms['windows-x86_64'], { url: assetUrl, signature: 'signed-payload' });
    assert.deepEqual(manifest.monorail, {
      channel: 'stable',
      dataSchemaVersion: 2,
      readableDataSchemaVersions: [2],
    });
    assert.ok(commands.some(args => args[0] === 'gh' && args[1] === 'release' && args[2] === 'edit' && args.includes('--draft=false') && args.includes('--latest=true')));
  });
}

test('publishes product beta release with prerelease=true, latest=false, and product monorail asset naming', async t => {
  const commands = [], writes = [];
  const repository = 'example/monorail', apiUrl = `https://api.github.com/repos/${repository}/releases/101`;
  const assetUrl = `https://api.github.com/repos/${repository}/releases/assets/99`;
  t.mock.module('node:child_process', { namedExports: {
    execFileSync: (command, args) => {
      commands.push([command, ...args]);
      if (command === 'git') return 'beta-tagged-commit';
      if (command !== 'gh') throw new Error(`Unexpected command: ${command}`);
      if (args[0] === 'api' && args[1] === apiUrl) {
        return JSON.stringify({ assets: [{ name: 'monorail_0.3.0-beta.1_windows-x86_64_setup.exe', url: assetUrl }] });
      }
      if (args[0] === 'release' && args[1] === 'view') {
        return JSON.stringify(args.at(-1) === 'apiUrl' ? { apiUrl } : { url: 'https://github.com/example/monorail/releases/tag/v0.3.0-beta.1' });
      }
      if (args[0] === 'release' && ['create', 'upload', 'edit'].includes(args[1])) return 'ok';
      throw new Error(`Unexpected gh arguments: ${args.join(' ')}`);
    },
  } });
  t.mock.module('node:fs/promises', { namedExports: {
    readFile: async path => {
      if (path === 'src-tauri/tauri.conf.json') return JSON.stringify({ plugins: { privateUpdater: { repository } } });
      if (path === 'package.json') return JSON.stringify({ version: '0.3.0-beta.1' });
      if (String(path).endsWith('.sig')) return 'beta-signed-payload';
      if (path === 'docs/releases/0.3.0-beta.1.md') return 'Beta 1 notes';
      throw new Error(`Unexpected file: ${path}`);
    },
    copyFile: async () => {},
    mkdtemp: async () => 'beta-release-directory',
    writeFile: async (path, text) => { writes.push([path, text]); },
  } });
  const previousArgv = process.argv;
  t.after(() => { process.argv = previousArgv; });
  process.argv = [
    process.execPath,
    'publish-release.mjs',
    '--tag',
    'v0.3.0-beta.1',
    '--installer',
    'src-tauri/target/release/bundle/nsis/单轨_0.3.0-beta.1_x64-setup.exe',
    '--notes',
    'docs/releases/0.3.0-beta.1.md',
  ];
  await import('./publish-release.mjs?mode=product-beta');
  const create = commands.find(args => args[0] === 'gh' && args[1] === 'release' && args[2] === 'create');
  assert.ok(create);
  assert.ok(create.includes('--prerelease'));
  assert.equal(create[create.indexOf('--title') + 1], '单轨 v0.3.0-beta.1');
  const edit = commands.find(args => args[0] === 'gh' && args[1] === 'release' && args[2] === 'edit');
  assert.ok(edit.includes('--draft=false'));
  assert.ok(edit.includes('--latest=false'));
  const manifest = JSON.parse(writes.find(([path]) => String(path).endsWith('latest.json'))[1]);
  assert.equal(manifest.version, '0.3.0-beta.1');
  assert.deepEqual(manifest.monorail, {
    channel: 'beta',
    dataSchemaVersion: 2,
    readableDataSchemaVersions: [2],
  });
});

test('keeps update-test release isolated with update-test prefix and channel metadata', async t => {
  const commands = [], writes = [];
  const repository = 'example/monorail', apiUrl = `https://api.github.com/repos/${repository}/releases/102`;
  const assetUrl = `https://api.github.com/repos/${repository}/releases/assets/105`;
  t.mock.module('node:child_process', { namedExports: {
    execFileSync: (command, args) => {
      commands.push([command, ...args]);
      if (command === 'git') return 'test-tagged-commit';
      if (command !== 'gh') throw new Error(`Unexpected command: ${command}`);
      if (args[0] === 'api' && args[1] === apiUrl) {
        return JSON.stringify({ assets: [{ name: 'monorail-update-test_0.1.3_windows-x86_64_setup.exe', url: assetUrl }] });
      }
      if (args[0] === 'release' && args[1] === 'view') {
        return JSON.stringify(args.at(-1) === 'apiUrl' ? { apiUrl } : { url: 'https://github.com/example/monorail/releases/tag/update-test-v0.1.3' });
      }
      if (args[0] === 'release' && ['create', 'upload', 'edit'].includes(args[1])) return 'ok';
      throw new Error(`Unexpected gh arguments: ${args.join(' ')}`);
    },
  } });
  t.mock.module('node:fs/promises', { namedExports: {
    readFile: async path => {
      if (path === 'src-tauri/tauri.conf.json') return JSON.stringify({ plugins: { privateUpdater: { repository } } });
      if (path === 'package.json') return JSON.stringify({ version: '0.1.3' });
      if (String(path).endsWith('.sig')) return 'test-signed-payload';
      if (path === 'notes.md') return 'Test notes';
      throw new Error(`Unexpected file: ${path}`);
    },
    copyFile: async () => {},
    mkdtemp: async () => 'update-test-directory',
    writeFile: async (path, text) => { writes.push([path, text]); },
  } });
  const previousArgv = process.argv;
  t.after(() => { process.argv = previousArgv; });
  process.argv = [
    process.execPath,
    'publish-release.mjs',
    '--tag',
    'update-test-v0.1.3',
    '--installer',
    'setup.exe',
    '--notes',
    'notes.md',
    '--prerelease',
  ];
  await import('./publish-release.mjs?mode=update-test');
  const create = commands.find(args => args[0] === 'gh' && args[1] === 'release' && args[2] === 'create');
  assert.ok(create.includes('--prerelease'));
  assert.equal(create[create.indexOf('--title') + 1], '更新验收 v0.1.3');
  const manifest = JSON.parse(writes.find(([path]) => String(path).endsWith('latest.json'))[1]);
  assert.equal(manifest.monorail.channel, 'update-test');
});

test('rejects mismatched tag, contradictory channel flags, or mismatched installer version', async t => {
  t.mock.module('node:fs/promises', { namedExports: {
    readFile: async path => {
      if (path === 'src-tauri/tauri.conf.json') return JSON.stringify({ plugins: { privateUpdater: { repository: 'example/monorail' } } });
      if (path === 'package.json') return JSON.stringify({ version: '0.3.0-beta.1' });
      throw new Error(`Unexpected file: ${path}`);
    },
    copyFile: async () => {},
    mkdtemp: async () => 'dir',
    writeFile: async () => {},
  } });
  const previousArgv = process.argv;
  t.after(() => { process.argv = previousArgv; });

  // 1. Beta version with update-test tag must be rejected
  process.argv = [process.execPath, 'publish-release.mjs', '--tag', 'update-test-v0.3.0-beta.1', '--installer', 'setup.exe', '--notes', 'n.md', '--prerelease'];
  await assert.rejects(import('./publish-release.mjs?err=1'), /base X\.Y\.Z/);

  // 2. Beta version with mismatched installer filename version must be rejected
  process.argv = [process.execPath, 'publish-release.mjs', '--tag', 'v0.3.0-beta.1', '--installer', '单轨_0.2.5_x64-setup.exe', '--notes', 'n.md'];
  await assert.rejects(import('./publish-release.mjs?err=2'), /Installer filename version/);
});

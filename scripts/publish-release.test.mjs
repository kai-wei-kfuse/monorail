import assert from 'node:assert/strict';
import { test } from 'node:test';

for (const isPrivate of [false, true]) {
  test(`publishes signed assets for a ${isPrivate ? 'private' : 'public'} repository using the existing tag`, async t => {
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
    const manifest = JSON.parse(writes.find(([path]) => String(path).endsWith('latest.json'))[1]);
    assert.equal(manifest.version, '0.2.2');
    assert.deepEqual(manifest.platforms['windows-x86_64'], { url: assetUrl, signature: 'signed-payload' });
    assert.ok(commands.some(args => args[0] === 'gh' && args[1] === 'release' && args[2] === 'edit' && args.includes('--draft=false')));
  });
}

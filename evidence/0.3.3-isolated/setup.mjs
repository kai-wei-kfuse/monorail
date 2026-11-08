import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { baseline } from './lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..');
const envPath = join(here, 'env.json');

let env;
if (existsSync(envPath) && !process.argv.includes('--fresh')) {
  env = JSON.parse(readFileSync(envPath, 'utf8'));
} else {
  const tag = randomBytes(6).toString('hex');
  const root = join(tmpdir(), `monorail-v033-${tag}`);
  const data = join(root, 'data');
  const identifier = `local.pixelrecord.v033test.t${tag}`;
  const productName = '单轨0.3.3隔离测试';
  const profile = join(process.env.APPDATA, identifier);
  const webview = join(process.env.LOCALAPPDATA, identifier);
  const pipe = `\\\\.\\pipe\\${identifier}.mcp`;
  const configPath = join(root, 'tauri.isolated.json');
  const exe = join(root, 'Monorail-0.3.3-isolated.exe');
  const mcp = join(root, 'monorail-mcp.mjs');
  const cli = join(root, 'monorail-cli.mjs');

  mkdirSync(data, { recursive: true });
  mkdirSync(profile, { recursive: true });
  writeFileSync(join(profile, 'config.json'), JSON.stringify({ root: data }, null, 2), 'utf8');

  writeFileSync(
    configPath,
    JSON.stringify(
      {
        identifier,
        productName,
        build: { beforeBuildCommand: null },
        bundle: { createUpdaterArtifacts: false },
        app: {
          security: {
            capabilities: [
              'main',
              'quickbar',
              'mini',
              'idea-window',
              {
                identifier: 'v033-isolated-data',
                description: 'Allow isolated test data directory in temporary root',
                windows: ['main', 'quickbar', 'mini', 'idea-*'],
                permissions: [
                  {
                    identifier: 'fs:scope',
                    allow: [{ path: data }, { path: join(data, '**') }],
                  },
                ],
              },
            ],
          },
        },
      },
      null,
      2,
    ),
    'utf8',
  );

  env = {
    tag,
    version: '0.3.3',
    root,
    data,
    identifier,
    productName,
    profile,
    webview,
    pipe,
    config: configPath,
    exe,
    mcp,
    cli,
    cdpPort: 19433,
  };
  writeFileSync(envPath, JSON.stringify(env, null, 2), 'utf8');
  writeFileSync(join(here, 'baseline-before.json'), JSON.stringify(baseline(), null, 2), 'utf8');
}

if (process.argv.includes('--build')) {
  console.log('Building frontend, MCP, CLI, and isolated debug executable...');
  execFileSync('npm.cmd', ['run', 'build'], { cwd: repo, stdio: 'inherit', shell: true });
  execFileSync('npm.cmd', ['run', 'mcp:build'], { cwd: repo, stdio: 'inherit', shell: true });
  execFileSync('npm.cmd', ['run', 'cli:build'], { cwd: repo, stdio: 'inherit', shell: true });
  execFileSync(
    process.execPath,
    [
      join(repo, 'node_modules', '@tauri-apps', 'cli', 'tauri.js'),
      'build',
      '--debug',
      '--no-bundle',
      '--config',
      env.config,
    ],
    { cwd: repo, stdio: 'inherit' },
  );
  copyFileSync(join(repo, 'src-tauri', 'target', 'debug', 'pixel-record.exe'), env.exe);
  copyFileSync(join(repo, 'dist-mcp', 'monorail-mcp.mjs'), env.mcp);
  copyFileSync(join(repo, 'dist-cli', 'monorail-cli.mjs'), env.cli);
}

console.log(JSON.stringify(env, null, 2));

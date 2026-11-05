// 生成 0.3.0-beta.4 隔离身份与数据目录，并构建隔离 exe（debug，不打包、不安装）。
// 用法：npm run build；node evidence/beta4-isolated/setup.mjs [--build]
import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { stringify } from 'yaml';
import { defaults as v1Defaults } from '../../src/data/migrations/v1/settings.ts';
import { baseline, here } from './lib.mjs';

const tag = randomBytes(6).toString('hex');
const root = join(tmpdir(), `monorail-b4-${tag}`), data = join(root, 'data');
const identifier = `local.pixelrecord.beta4test.t${tag}`, productName = '单轨Beta4隔离验收';
await mkdir(data, { recursive: true });
await mkdir(here, { recursive: true });
const before = baseline();
await writeFile(join(here, 'baseline-before.json'), JSON.stringify(before, null, 2));

// 首次启动前就关掉开机自启、换成隔离快捷键（启动时会按 settings.yaml 应用到系统）；没有 state.yaml，由 v1 → v2 迁移建出一致的数据
await writeFile(join(data, 'settings.yaml'), stringify({ ...v1Defaults, autostart: false, quickbarHotkey: 'Ctrl+Alt+Shift+F11', mainHotkey: 'Ctrl+Alt+Shift+F12' }));
const profile = join(process.env.APPDATA, identifier);
await rm(profile, { recursive: true, force: true });
await mkdir(profile, { recursive: true });
await writeFile(join(profile, 'config.json'), JSON.stringify({ root: data }));
// 小窗第一次打开放在屏幕靠上的位置（物理像素），先测弹层往下；贴底边的情况在 run.mjs 里移窗口再测
await writeFile(join(profile, 'mini-window.json'), JSON.stringify({ x: 260, y: 160, width: 520, height: 88 }));

const config = JSON.parse(await readFile('src-tauri/tauri.conf.json', 'utf8'));
config.identifier = identifier; config.productName = productName;
config.build.beforeBuildCommand = null;          // dist 由 setup 之前的 npm run build 生成（与本次提交相同的前端代码）
config.bundle.createUpdaterArtifacts = false;
config.app.windows.find(w => w.label === 'main').title = `${productName} v0.3.0-beta.4`;
config.app.security.capabilities.push({ identifier: 'beta4-isolated-data', windows: ['main', 'quickbar', 'mini'],
  permissions: [{ identifier: 'fs:scope', allow: [{ path: data }, { path: join(data, '**') }] }] });
const configPath = join(root, 'tauri.isolated.json');
await writeFile(configPath, JSON.stringify(config, null, 2));
const exe = join(root, 'Monorail-beta4-isolated.exe');
const env = { tag, root, data, identifier, productName, profile, webview: join(process.env.LOCALAPPDATA, identifier),
  pipe: `\\\\.\\pipe\\${identifier}.mcp`, config: configPath, exe, mcp: join(root, 'monorail-mcp.mjs'), cli: join(root, 'monorail-cli.mjs') };
await writeFile(join(here, 'env.json'), JSON.stringify(env, null, 2));
console.log(JSON.stringify(env, null, 2));

if (process.argv.includes('--build')) {
  execFileSync(process.execPath, ['node_modules/@tauri-apps/cli/tauri.js', 'build', '--debug', '--no-bundle', '--config', configPath], { stdio: 'inherit' });
  await copyFile(resolve('src-tauri/target/debug/pixel-record.exe'), exe);
  await copyFile(resolve('dist-mcp/monorail-mcp.mjs'), env.mcp);
  await copyFile(resolve('dist-cli/monorail-cli.mjs'), env.cli);
  console.log('BUILT', exe);
}

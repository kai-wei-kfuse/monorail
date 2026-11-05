// 收尾：停掉隔离进程，记最终基线，删掉 beta.4 隔离身份的配置目录、WebView2 目录和临时目录。
// 删除前逐个核对路径前缀，只删本次隔离实测自己建的东西。用法：node evidence/beta4-isolated/cleanup.mjs
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { baseline, count, here, kill, loadEnv, sleep } from './lib.mjs';

const env = await loadEnv();
kill(env.exe); await sleep(1000);
assert.equal(count(env.exe), 0);
const after = baseline(), before = JSON.parse(await readFile(join(here, 'baseline-before.json'), 'utf8'));
assert.match(env.identifier, /^local\.pixelrecord\.beta4test\.t[0-9a-f]{12}$/);
assert.equal(resolve(env.profile), resolve(process.env.APPDATA, env.identifier));
assert.equal(resolve(env.webview), resolve(process.env.LOCALAPPDATA, env.identifier));
assert.ok(resolve(env.root).startsWith(resolve(tmpdir())) && /monorail-b4-[0-9a-f]{12}$/.test(env.root));
for (const dir of [env.profile, env.webview, env.root]) await rm(dir, { recursive: true, force: true });
const out = {
  identifier: env.identifier, takenAt: new Date().toISOString(),
  runSame: JSON.stringify(before.run) === JSON.stringify(after.run),
  isolatedRunEntry: Object.keys(after.run).filter(k => k.includes('Beta4') || k.includes('隔离')),
  dailyExeSame: before.daily.exe === after.daily.exe, dailyConfigSame: before.daily.config === after.daily.config, dailyPid: [before.daily.pid, after.daily.pid],
  removed: [env.profile, env.webview, env.root].map(d => ({ dir: d, gone: !existsSync(d) })),
};
await writeFile(join(here, process.argv[2] ?? 'cleanup.json'), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));

// 收尾：停掉隔离进程，0.2.5 隔离数据还原，记最终基线，删掉 beta.3 隔离身份的配置目录、WebView2 目录和临时目录。
// 删除前逐个核对路径前缀，只删本次隔离实测自己建的东西。
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { baseline, count, here, kill, loadEnv, sleep } from './lib.mjs';

const env = await loadEnv();
const old = { exe: join(process.env.TEMP, 'monorail-025-db06cfcd51d6', 'Monorail-0.2.5-isolated.exe'), data: join(process.env.TEMP, 'monorail-025-db06cfcd51d6', 'data') };
kill(env.exe); kill(old.exe); await sleep(1000);
assert.equal(count(env.exe), 0); assert.equal(count(old.exe), 0);

// 0.2.5 隔离数据还原成实测前的样子
const original = join(env.root, 'data025-original');
const restored = existsSync(original);
if (restored) { await rm(old.data, { recursive: true, force: true }); await rename(original, old.data); }

const after = baseline(), before = JSON.parse(await readFile(join(here, 'baseline-before.json'), 'utf8'));
await writeFile(join(here, 'baseline-after.json'), JSON.stringify({ ...after, takenAt: new Date().toISOString() }, null, 2));

// 只删 beta.3 隔离身份自己的目录
assert.match(env.identifier, /^local\.pixelrecord\.beta3test\.t[0-9a-f]{12}$/);
assert.equal(resolve(env.profile), resolve(process.env.APPDATA, env.identifier));
assert.equal(resolve(env.webview), resolve(process.env.LOCALAPPDATA, env.identifier));
assert.ok(resolve(env.root).startsWith(resolve(tmpdir())) && /monorail-b3-[0-9a-f]{12}$/.test(env.root));
for (const dir of [env.profile, env.webview, env.root]) await rm(dir, { recursive: true, force: true });

const out = {
  restored025Data: restored,
  runSame: JSON.stringify(before.run) === JSON.stringify(after.run),
  isolatedRunEntry: Object.keys(after.run).filter(k => k.includes('Beta3') || k.includes('隔离')),
  dailyExeSame: before.daily.exe === after.daily.exe, dailyConfigSame: before.daily.config === after.daily.config, dailyPid: [before.daily.pid, after.daily.pid],
  removed: [env.profile, env.webview, env.root].map(d => ({ dir: d, gone: !existsSync(d) })),
};
await writeFile(join(here, 'cleanup.json'), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));

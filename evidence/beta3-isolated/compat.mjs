// v0.2.5 兼容矩阵 1–5 隔离实测（ADR 0019「兼容与恢复」）。用 2026-11-01 已建好的 0.2.5 隔离 exe（identifier local.pixelrecord.test025.tdb06cfcd51d6，
// 只允许读写它自己的 data 目录），每个场景：beta.3 数据副本 → 构造未完成 journal → 真 0.2.5 打开 / 恢复 / 改写 → 交回真 beta.3 打开 → 核对。
// 用法：node evidence/beta3-isolated/compat.mjs [场景…]
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { build } from 'esbuild';
import { connect, count, evidenceLines, here, kill, launch, loadEnv, sleep } from './lib.mjs';

const env = await loadEnv();
const old = { exe: join(process.env.TEMP, 'monorail-025-db06cfcd51d6', 'Monorail-0.2.5-isolated.exe'), data: join(process.env.TEMP, 'monorail-025-db06cfcd51d6', 'data'),
  profile: join(process.env.APPDATA, 'local.pixelrecord.test025.tdb06cfcd51d6'), port: 19381 };
assert.ok(existsSync(old.exe), '0.2.5 isolated exe');
assert.equal(JSON.parse(await readFile(join(old.profile, 'config.json'), 'utf8')).root, old.data);
const base = join(env.root, 'compat-base'), shots = join(here, 'shots'), resultsPath = join(here, 'compat-results.json');
const results = existsSync(resultsPath) ? JSON.parse(await readFile(resultsPath, 'utf8')) : {};

await build({ entryPoints: [join(here, 'compat-craft.ts')], bundle: true, platform: 'node', format: 'esm', target: 'node22', outfile: join(env.root, 'compat-craft.mjs'), logLevel: 'error',
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" } });
const craft = (scenario, data) => JSON.parse(execFileSync(process.execPath, [join(env.root, 'compat-craft.mjs'), scenario, data], { encoding: 'utf8' }).trim().split('\n').at(-1));

// 第一次：把 0.2.5 原有的隔离数据挪开备份；beta.3 实测结束时的数据存一份作为每个场景的起点
if (!existsSync(join(env.root, 'data025-original'))) { kill(old.exe); await rename(old.data, join(env.root, 'data025-original')); }
if (!existsSync(base)) { kill(env.exe); await cp(env.data, base, { recursive: true }); }

async function files(data, dir) { const d = join(data, dir); return existsSync(d) ? (await readdir(d, { recursive: true })).filter(f => f.endsWith('.json') || f.endsWith('.md')) : []; }
async function historyRecords(data) {
  const out = [];
  for (const f of await files(data, 'history')) out.push(JSON.parse(await readFile(join(data, 'history', f), 'utf8')));
  return out;
}
async function open(exe, profile, port, name, data) {
  kill(exe);
  const before = (await evidenceLines(profile)).length;
  launch(exe, port);
  const page = await connect(port, 'main', 160);
  let text = '';
  for (let i = 0; i < 100; i++) { text = await page.text().catch(() => ''); if ((text.includes('首页') && !text.includes('正在打开数据目录')) || text.includes('打不开')) break; await sleep(200); }
  await sleep(1500);
  text = await page.text();
  await page.shot(join(shots, `compat-${name}.png`));
  const ev = (await evidenceLines(profile)).slice(before).map(e => e.message);
  page.close();
  await sleep(500);
  kill(exe);
  await sleep(800);
  return { opened: text.includes('首页') && !text.includes('打不开'), error: /打不开[^\n]*/.exec(text)?.[0] ?? null, evidence: ev.filter(m => !m.startsWith('reminder')).slice(0, 6),
    journals: (await files(data, '.journal')).length, processesLeft: count(exe) };
}
const field = (text, key) => new RegExp(`^${key}: (.*)$`, 'm').exec(text)?.[1] ?? null;

const scenarios = {
  async m1() { return { craft: null }; },
  async m2() { return { craft: craft('m2', old.data) }; },
  async m3() { return { craft: craft('m3', old.data) }; },
  async m4() { return { craft: craft('m4', old.data) }; },
  async 'm5-card'() { return { craft: craft('m5-card', old.data) }; },
  async 'm5-record'() { return { craft: craft('m5-record', old.data) }; },
  async 'm5-history'() { return { craft: craft('m5-history', old.data) }; },
};

const wanted = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(scenarios);
for (const name of wanted) {
  const r = { ok: false };
  try {
    await rm(old.data, { recursive: true, force: true });
    await cp(base, old.data, { recursive: true });
    const hBefore = (await historyRecords(old.data)).length;
    Object.assign(r, await scenarios[name]());
    r.pendingJournals = (await files(old.data, '.journal')).length;
    // 1. 真 0.2.5 打开
    r.v025 = await open(old.exe, old.profile, old.port, `${name}-025`, old.data);
    const h025 = await historyRecords(old.data);
    r.v025.historyFiles = h025.length; r.v025.historyAddedByRecovery = h025.length - hBefore;
    if (name === 'm3') r.v025.settingsTitleScale = field(await readFile(join(old.data, 'settings.yaml'), 'utf8'), 'titleScale');
    if (name === 'm3') r.v025.mergedRecord = h025.filter(x => x.subject?.id === 'titleScale').map(x => ({ merged: x.merged ?? 1, changes: x.changes.map(c => `${c.before}→${c.after}`) }));
    const recId = r.craft?.recordId;
    if (recId) {
      const t = await readFile(join(old.data, 'records', `${recId}.md`), 'utf8');
      r.v025.record = { created_via: field(t, 'created_via'), history_logged_at: field(t, 'history_logged_at'), card_id: field(t, 'card_id') };
    }
    if (r.craft?.loggedRecord) r.v025.loggedRecordKept = (await readFile(join(old.data, r.craft.loggedRecord), 'utf8')).includes('history_logged_at');
    // 2. 交回真 beta.3（只允许它自己的 data 目录，所以复制过去）
    kill(env.exe);
    await rm(env.data, { recursive: true, force: true });
    await cp(old.data, env.data, { recursive: true });
    r.beta3 = await open(env.exe, env.profile, 19371, `${name}-beta3`, env.data);
    const h3 = await historyRecords(env.data);
    r.beta3.historyFiles = h3.length;
    if (recId) {
      const t = await readFile(join(env.data, 'records', `${recId}.md`), 'utf8');
      const cards = [];
      for (const f of await files(env.data, 'cards')) { const c = await readFile(join(env.data, 'cards', f), 'utf8'); if (c.includes(recId)) cards.push(f); }
      r.beta3.record = { created_via: field(t, 'created_via'), history_logged_at: field(t, 'history_logged_at') ? 'set' : null, card_id: field(t, 'card_id') };
      r.beta3.cardsForRecord = cards.length;
      r.beta3.quickbarHistory = h3.filter(x => x.subject?.id === recId && x.action.startsWith('quickbar.')).length;
    }
    // 断言
    assert.ok(r.v025.opened, `0.2.5 opened (${r.v025.error})`);
    assert.equal(r.v025.journals, 0, '0.2.5 drained journals');
    assert.ok(r.beta3.opened, `beta.3 opened (${r.beta3.error})`);
    assert.equal(r.beta3.journals, 0);
    if (name === 'm2') assert.ok(r.v025.historyAddedByRecovery >= 1, '0.2.5 wrote the pending history file');
    if (name === 'm3') { assert.equal(r.v025.settingsTitleScale, '80'); assert.ok(r.v025.mergedRecord.some(x => x.merged === 2), 'rewritten merged history'); }
    if (recId) { assert.equal(r.v025.record.created_via, 'quickbar', '0.2.5 kept created_via'); assert.equal(r.beta3.cardsForRecord, 1, 'one card'); assert.equal(r.beta3.quickbarHistory, 1, 'one quickbar history'); }
    if (r.craft?.loggedRecord) assert.ok(r.v025.loggedRecordKept);
    r.ok = true;
  } catch (error) { r.error = String(error?.stack ?? error); }
  results[name] = r;
  await writeFile(resultsPath, JSON.stringify(results, null, 2));
  console.log(r.ok ? 'PASS' : 'FAIL', name, r.ok ? '' : r.error.split('\n')[0]);
}
process.exit(0);

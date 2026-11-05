// 0.3.1 隔离真窗口测试（照 beta4-isolated/run.mjs）：隔离身份的 debug exe + WebView2 CDP 驱动真窗口，CLI 走隔离管道。
// 只测到目前（G1–G6b、G8、G7 的宽松显示）已经做了界面或接口的部分；插入卡、背包抽屉、翻卡等 G7 界面还没做，不在这里。
// 用法：node evidence/0.3.1-isolated/run.mjs [步骤名…]（不给就全跑）。结果写 results.json，截图写 shots/。
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { parse, stringify } from 'yaml';
import { baseline, connect, count, evidenceLines, here, kill, launch, loadEnv, sleep } from './lib.mjs';

const env = await loadEnv(), PORT = 19391, shots = join(here, 'shots');
await mkdir(shots, { recursive: true });
const resultsPath = join(here, 'results.json');
const results = existsSync(resultsPath) ? JSON.parse(await readFile(resultsPath, 'utf8')) : {};
const save = () => writeFile(resultsPath, JSON.stringify(results, null, 2));
const ctx = {};

async function history() {
  const dir = join(env.data, 'history'), out = [];
  if (!existsSync(dir)) return out;
  for (const day of await readdir(dir)) for (const f of await readdir(join(dir, day))) out.push(JSON.parse(await readFile(join(dir, day, f), 'utf8')));
  return out.sort((a, b) => a.at.localeCompare(b.at));
}
async function main() {
  if (!ctx.main) ctx.main = await connect(PORT, 'main');
  return ctx.main;
}
function cli(args, extraEnv = {}) {
  const r = spawnSync(process.execPath, [env.cli, ...args], { encoding: 'utf8', env: { ...process.env, CLAUDECODE: '', CODEX_SANDBOX: '', MONORAIL_AGENT: '', ...extraEnv,
    MONORAIL_PIPE: env.pipe, MONORAIL_CONFIG_DIR: env.profile, MONORAIL_EXECUTABLE: env.exe } });
  return { code: r.status, out: r.stdout, err: r.stderr, json: (() => { try { return JSON.parse(r.stdout); } catch { return null; } })() };
}
const homeReady = `document.body.innerText.includes('首页') && !document.body.innerText.includes('正在打开数据目录')`;
const restart = async () => {
  ctx.main?.close(); ctx.main = null; kill(env.exe); await sleep(1200);
  launch(env.exe, PORT);
  const page = await main();
  await page.waitFor(homeReady, 30_000, 'home');
  await sleep(800);
  return page;
};
const settingsPath = () => join(env.data, 'settings.yaml');
const setSettings = async patch => { const s = parse(await readFile(settingsPath(), 'utf8')); await writeFile(settingsPath(), stringify(patch(s))); };
const statusText = page => page.eval(`document.querySelector('.status')?.innerText.replace(/\\s+/g, ' ').trim() ?? ''`);
const tbarText = page => page.eval(`[document.querySelector('.tbar-tag')?.innerText, document.querySelector('.tbar-clock')?.innerText, document.querySelector('.f-sub, .tbar ~ * .f-sub, .tbar p')?.innerText].map(t => (t ?? '').replace(/\\s+/g, ' ').trim())`);
// 列表的描述是可直接编辑的输入框：文字在 input.value 里，innerText 读不到
const LIST_TEXT = "(() => { const t = document.body.innerText + ' ' + [...document.querySelectorAll('input')].map(i => i.value).join(' '); return t.includes('隔离测试：读龙书') && t; })()";
const ledKind = page => page.eval(`document.querySelector('.status .st-led')?.dataset.kind ?? null`);

const steps = {
  /** 启动：v1 → v2 迁移；0.3.1 四个新设置键缺省（defaultWhenMissing）；补两个项目再启动 */
  async boot() {
    kill(env.exe);
    launch(env.exe, PORT);
    let page = await main();
    await page.waitFor(homeReady, 30_000, 'home');
    await setSettings(s => ({ ...s, lists: { ...s.lists, projects: [{ name: '学习', color: '#1aa3ff' }, { name: '工作', color: '#7c5cff' }] } }));
    page = await restart();
    const ev = await evidenceLines(env.profile);
    await page.shot(join(shots, '01-boot-home.png'));
    const s = parse(await readFile(settingsPath(), 'utf8'));
    assert.ok(ev.some(e => e.message.startsWith('connected:')), 'connected evidence');
    assert.ok(!Object.keys(baseline().run).includes(env.productName), 'no isolated Run entry');
    return { title: await page.eval('document.title'), processes: count(env.exe), settingsKeysWritten: ['taskMode', 'trackingMode', 'insertBackPlace', 'idleAskMinutes'].filter(k => k in s) };
  },
  /** 紧凑模式（默认）：首页待机照常显示，标题栏强调色灯 */
  async strictIdle() {
    const page = await main();
    await page.click('.tab-btn', '首页'); await sleep(400);
    const status = await statusText(page), led = await ledKind(page), tbar = await tbarText(page);
    await page.shot(join(shots, '02-strict-idle-home.png'));
    assert.match(status, /待机/); assert.equal(led, 'idle');
    return { status, led, tbar };
  },
  /** 设置 04 切到宽松：首页「没在计时」、读数不走、标题栏灰灯；回看开关改「含睡眠」；设置里「空闲多久后追问」隐藏 */
  async looseIdle() {
    const page = await main();
    await page.click('.tab-btn', '设置'); await sleep(400);
    await page.click('.s-item', '计时'); await sleep(400);
    const strictRows = await page.eval(`document.body.innerText.includes('空闲多久后追问')`);
    await page.click('.seg[aria-label="计时模式"] button', '宽松'); await sleep(800);
    const looseRows = await page.eval(`document.body.innerText.includes('空闲多久后追问')`);
    const offlineRow = await page.eval(`document.body.innerText.includes('离线追问最小间隔')`);
    await page.shot(join(shots, '03-loose-settings.png'));
    await page.click('.tab-btn', '首页'); await sleep(600);
    const t1 = await tbarText(page); await sleep(2200); const t2 = await tbarText(page);
    const status = await statusText(page), led = await ledKind(page);
    await page.shot(join(shots, '04-loose-idle-home.png'));
    const file = parse(await readFile(settingsPath(), 'utf8'));
    assert.equal(file.trackingMode, 'loose');
    assert.equal(strictRows, true); assert.equal(looseRows, false); assert.equal(offlineRow, true);
    assert.match(status, /没在计时/); assert.equal(led, 'off');
    assert.match(t1.join(' '), /没在计时/); assert.equal(t1[1], t2[1], 'readout does not move');
    // 日历：〔显示待机〕开关不显示
    await page.click('.tab-btn', '日历'); await sleep(600);
    const calToggle = await page.eval(`document.body.innerText.includes('显示待机')`);
    await page.shot(join(shots, '05-loose-calendar.png'));
    assert.equal(calToggle, false);
    // 回看：开关是「含睡眠」
    await page.click('.tab-btn', '回顾'); await sleep(800);
    const reviewText = await page.text();
    await page.shot(join(shots, '06-loose-review.png'));
    return { status, led, tbar: t1, readoutStill: t1[1] === t2[1], calendarIdleToggle: calToggle, reviewSleepOnly: reviewText.includes('含睡眠') && !reviewText.includes('含待机/睡眠') };
  },
  /** 切回紧凑：待机照常显示 */
  async backToStrict() {
    const page = await main();
    await page.click('.tab-btn', '设置'); await sleep(400);
    await page.click('.s-item', '计时'); await sleep(400);
    await page.click('.seg[aria-label="计时模式"] button', '紧凑'); await sleep(800);
    await page.click('.tab-btn', '首页'); await sleep(600);
    const status = await statusText(page), led = await ledKind(page);
    assert.match(status, /待机/); assert.equal(led, 'idle');
    assert.equal(parse(await readFile(settingsPath(), 'utf8')).trackingMode, 'strict');
    return { status, led };
  },
  /** G8：CLI entry edit / update_time_entry；agent 规则在 --help 和未知命令里；界面跟着变 */
  async updateEntry() {
    const page = await main();
    const before = (await history()).filter(r => r.action === 'auto.update_time_entry').length;
    const help = cli(['--help', '--json']);
    assert.match(help.json.rules, /只能由单轨程序读写/);
    const unknown = cli(['entry', 'delete', 'x', '--json']);
    assert.equal(unknown.code, 2); assert.match(unknown.json.error.next_step, /不要直接改单轨数据目录里的文件/);
    const day = new Date(); day.setHours(0, 0, 0, 0);
    const iso = (h, m) => { const d = new Date(day); d.setHours(h, m); return d.toISOString().replace('Z', '+00:00'); };
    // 今天活动日内、已经过去的一段（开机后的现在之前）
    const now = new Date(), start = new Date(now.getTime() - 50 * 60_000), end = new Date(now.getTime() - 20 * 60_000);
    const add = cli(['time', 'add', '隔离测试：读书', '--start', start.toISOString().replace('Z', '+00:00'), '--end', end.toISOString().replace('Z', '+00:00'), '--project', '学习', '--json'], { CLAUDECODE: '1' });
    assert.equal(add.code, 0, add.out + add.err);
    const id = add.json.result.data.entry.id;
    const newEnd = new Date(end.getTime() - 5 * 60_000).toISOString().replace('Z', '+00:00');
    const edit = cli(['entry', 'edit', id, '--end', newEnd, '--description', '隔离测试：读龙书', '--tag', '编译', '--json'], { CLAUDECODE: '1' });
    assert.equal(edit.code, 0, edit.out + edit.err);
    const e = edit.json.result.data.entry;
    assert.equal(e.description, '隔离测试：读龙书'); assert.deepEqual(e.tags, ['编译']); assert.equal(Date.parse(e.ended_at), Date.parse(newEnd));
    // 开着的待机不能改成别的活动
    const ctxRes = cli(['context', '--json']);
    const openId = ctxRes.json.result.timer.open_entry.id;
    const idle = cli(['entry', 'edit', openId, '--description', '其实在工作', '--json']);
    assert.equal(idle.code, 3); assert.equal(idle.json.error.code, 'ENTRY_IS_IDLE');
    // 列表页能看到改过的记录；操作历史记成 CLI · Claude Code
    await page.click('.tab-btn', '列表');
    const listText = await page.waitFor(LIST_TEXT, 10_000, 'list shows edited entry');
    await page.shot(join(shots, '07-list-after-cli-edit.png'));
    const recs = (await history()).filter(r => r.action === 'auto.update_time_entry');
    assert.ok(listText.includes('隔离测试：读龙书'), 'list shows edited entry');
    assert.equal(recs.length, before + 1); assert.equal(recs.at(-1).source.kind, 'cli');
    return { added: id, edited: e, idleRefused: idle.json.error.code, history: recs.map(r => ({ action: r.action, source: r.source })), agentRules: help.json.rules.slice(0, 40) };
  },
  /** 任务模式默认开；首页没有〔再抽一张〕 */
  async taskMode() {
    const page = await main();
    await page.click('.tab-btn', '首页'); await sleep(400);
    const text = await page.text();
    await page.click('.tab-btn', '设置'); await sleep(400);
    await page.click('.s-item', '任务模式'); await sleep(400);
    await page.shot(join(shots, '08-settings-quest-mode.png'));
    const settingsText = await page.text();
    await page.click('.tab-btn', '首页'); await sleep(300);
    return { noRedraw: !text.includes('再抽一张'), questModeSection: settingsText.includes('任务模式'), taskModeFile: parse(await readFile(settingsPath(), 'utf8')).taskMode ?? '（缺省，按 true）' };
  },
  /** 第 1 轮 updateEntry 读列表太早（截图里其实已经有了）：重开一次，等列表出现改过的记录，核对历史 */
  async listCheck() {
    const page = await restart();
    await page.click('.tab-btn', '列表');
    const text = await page.waitFor(LIST_TEXT, 10_000, 'list shows edited entry');
    await page.shot(join(shots, '07b-list-after-restart.png'));
    const recs = (await history()).filter(r => r.action === 'auto.update_time_entry');
    assert.ok(recs.length >= 1); assert.ok(recs.every(r => r.source.kind === 'cli'));
    return { listHasEdited: text.includes('#编译') || text.includes('编译'), history: recs.map(r => ({ action: r.action, source: r.source, subject: r.subject })) };
  },
  async finish() {
    ctx.main?.close(); ctx.main = null;
    kill(env.exe);
    await sleep(800);
    const after = baseline(), before = JSON.parse(await readFile(join(here, 'baseline-before.json'), 'utf8'));
    await writeFile(join(here, 'baseline-after.json'), JSON.stringify(after, null, 2));
    const all = await history();
    await writeFile(join(here, 'history-records.json'), JSON.stringify(all, null, 2));
    return { runSame: JSON.stringify(before.run) === JSON.stringify(after.run), dailyExeSame: before.daily.exe === after.daily.exe,
      dailyConfigSame: before.daily.config === after.daily.config, dailyPid: [before.daily.pid, after.daily.pid], historyCount: all.length,
      actions: all.map(r => `${r.action}@${r.source.kind}${r.source.via ? '/' + r.source.via : ''}`) };
  },
};

const order = Object.keys(steps), wanted = process.argv.slice(2).length ? process.argv.slice(2) : order;
for (const name of wanted) {
  const t0 = Date.now();
  try { results[name] = { ok: true, ...await steps[name]() }; results[name].ms = Date.now() - t0; console.log('PASS', name); }
  catch (error) { results[name] = { ok: false, ms: Date.now() - t0, error: String(error?.stack ?? error) }; console.log('FAIL', name, String(error)); }
  await save();
}
ctx.main?.close?.();
process.exit(0);

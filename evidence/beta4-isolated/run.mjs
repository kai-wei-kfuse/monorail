// 0.3.0-beta.4 隔离真窗口实测（执行方案 §3）：隔离身份的 debug exe + WebView2 CDP 驱动真窗口，CLI 走隔离管道。
// 用法：node evidence/beta4-isolated/run.mjs [步骤名…]（不给就全跑）。结果写 results.json，截图写 shots/。
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { parse, stringify } from 'yaml';
import { baseline, connect, count, evidenceLines, here, kill, launch, loadEnv, sleep } from './lib.mjs';

const env = await loadEnv(), PORT = 19381, shots = join(here, 'shots');
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
const newSince = async n => (await history()).slice(n);
const record = async id => readFile(join(env.data, 'records', `${id}.md`), 'utf8');
async function main() {
  if (!ctx.main || ctx.main.dead) { ctx.main = await connect(PORT, 'main'); }
  return ctx.main;
}
async function mini() {
  if (!ctx.mini) ctx.mini = await connect(PORT, 'mini');
  return ctx.mini;
}
function cli(args, extraEnv = {}) {
  const r = spawnSync(process.execPath, [env.cli, ...args], { encoding: 'utf8', env: { ...process.env, CLAUDECODE: '', CODEX_SANDBOX: '', MONORAIL_AGENT: '', ...extraEnv,
    MONORAIL_PIPE: env.pipe, MONORAIL_CONFIG_DIR: env.profile, MONORAIL_EXECUTABLE: env.exe } });
  return { code: r.status, out: r.stdout, err: r.stderr, json: (() => { try { return JSON.parse(r.stdout); } catch { return null; } })() };
}
/** 小窗的几何（逻辑像素）：窗口在屏幕上的位置和大小、本体（.miniwin）在屏幕上的位置、弹层的状态。 */
const geo = page => page.eval(`(() => { const w = document.querySelector('.miniwin')?.getBoundingClientRect(), pop = document.querySelector('.mini-pop');
  return { x: screenX, y: screenY, w: outerWidth, h: outerHeight, barTop: w ? screenY + w.top : null, barH: w ? w.height : null,
    pop: pop ? { up: pop.classList.contains('up'), h: pop.getBoundingClientRect().height, sug: !!pop.querySelector('.sug'), cat: !!pop.querySelector('.mini-cat-list') } : null,
    availTop: screen.availTop, availH: screen.availHeight, dpr: devicePixelRatio,
    title: document.querySelector('.mini-title b')?.textContent ?? null, cat: document.querySelector('.mini-cat span, .mini-pick')?.textContent ?? null,
    close: !!document.querySelector('[aria-label="关闭小窗口"]'), timeFont: getComputedStyle(document.querySelector('.mini-time')).fontSize }; })()`);
async function enter(page) {
  await page.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await page.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
}
/** 真实鼠标按下（自动完成、分类下拉都是 mousedown 选中）。 */
async function press(page, selector, text) {
  const r = await page.rect(selector, text);
  if (!r) throw new Error(`press: ${selector} ${text ?? ''}`);
  const x = r.x + r.w / 2, y = r.y + r.h / 2;
  await page.mouse('mouseMoved', x, y, 0); await page.mouse('mousePressed', x, y); await page.mouse('mouseReleased', x, y);
  await sleep(400);
}

const steps = {
  async boot() {
    kill(env.exe);
    launch(env.exe, PORT);
    let page = await main();
    await page.waitFor(`document.body.innerText.includes('首页') && !document.body.innerText.includes('正在打开数据目录')`, 30_000, 'home');
    // 首次启动按 v1 → v2 迁移建好数据后停掉，补两个用户项目（学习、工作）再启动：新目录里只有系统项目
    page.close(); ctx.main = null; kill(env.exe); await sleep(1200);
    const settingsPath = join(env.data, 'settings.yaml'), settings = parse(await readFile(settingsPath, 'utf8'));
    settings.lists.projects = [{ name: '学习', color: '#1aa3ff' }, { name: '工作', color: '#7c5cff' }];
    await writeFile(settingsPath, stringify(settings));
    launch(env.exe, PORT);
    page = await main();
    await page.waitFor(`document.body.innerText.includes('首页') && !document.body.innerText.includes('正在打开数据目录')`, 30_000, 'home');
    await sleep(800);
    const ev = await evidenceLines(env.profile);
    await page.shot(join(shots, '01-boot-home.png'));
    assert.ok(ev.some(e => e.message.startsWith('connected:')), 'connected evidence');
    assert.ok(!Object.keys(baseline().run).includes(env.productName), 'no isolated Run entry');
    return { title: await page.eval('document.title'), processes: count(env.exe) };
  },
  /** D2：想法池〔完成〕/ 已完成列表 /〔撤销完成〕；CLI idea done 与 find_items 状态。 */
  async ideas() {
    const page = await main(), before = (await history()).length;
    const a = cli(['idea', 'add', '隔离验收：试试楼下的手冲咖啡 #生活', '--json']), b = cli(['idea', 'add', '隔离验收：查一下公积金提取流程', '--json']);
    const idA = a.json.result.data.id, idB = b.json.result.data.id;
    await page.click('.tab-btn', '背包'); await sleep(400);
    await page.click('.s-item', '想法池'); await sleep(400);
    await page.waitFor(`document.querySelectorAll('.id-ok').length >= 2`, 8000, 'complete buttons');
    await page.shot(join(shots, '02-d2-idea-pool.png'));
    // 点〔完成〕：这一行离开想法池，右上角提示
    await page.eval(`[...document.querySelectorAll('.ls-item')].find(li => li.textContent.includes('手冲咖啡')).querySelector('.id-ok').click()`);
    const toast = await page.waitFor(`[...document.querySelectorAll('.toast b')].map(b => b.textContent).find(t => t.includes('已完成'))`, 5000, 'toast');
    await page.shot(join(shots, '03-d2-after-complete.png'));
    const poolText = await page.eval(`document.querySelector('.ls')?.innerText ?? ''`);
    const fileA = await record(idA);
    assert.match(fileA, /pool: 冷库/); assert.match(fileA, /completed_at:/); assert.match(fileA, /kind: manual/);
    assert.ok(!poolText.includes('手冲咖啡'), 'left the pool list');
    // 已完成列表
    await page.click('.id-seg button', '已完成'); await sleep(300);
    const doneText = await page.eval(`document.querySelector('.ls')?.innerText ?? ''`);
    await page.shot(join(shots, '04-d2-done-list.png'));
    assert.match(doneText, /手冲咖啡/); assert.match(doneText, /完成于 今天/); assert.match(doneText, /手动/);
    // 撤销完成：回到想法池
    await page.eval(`[...document.querySelectorAll('.ls-item')].find(li => li.textContent.includes('手冲咖啡')).querySelector('.sbtn').click()`);
    await sleep(800);
    const fileA2 = await record(idA);
    assert.match(fileA2, /pool: 活跃池/); assert.match(fileA2, /completed_at: null/);
    // CLI：把 B 标完成，再标一次是 noop；find --include-archived 状态是「已完成」
    const done = cli(['idea', 'done', idB, '--json'], { CLAUDECODE: '1' }), again = cli(['idea', 'done', idB, '--json']);
    const found = cli(['find', '公积金', '--kind', 'idea', '--include-archived', '--json']);
    const bad = cli(['idea', 'done', idA.replace(/.$/, c => c === '0' ? '1' : '0'), '--json']);
    await sleep(800);
    const doneText2 = await page.eval(`document.querySelector('.ls')?.innerText ?? ''`);
    await page.shot(join(shots, '05-d2-done-by-cli.png'));
    const added = (await newSince(before)).map(r => ({ action: r.action, label: r.label, kind: r.source.kind, via: r.source.via, agent: r.source.agent?.name ?? null,
      changes: r.changes.filter(c => c.field === '池').map(c => `${c.before}→${c.after}`) }));
    assert.equal(done.code, 0); assert.equal(done.json.result.data.noop, false);
    assert.equal(again.code, 0); assert.equal(again.json.result.data.noop, true);
    assert.equal(found.json.result.ideas[0].pool, '已完成');
    assert.equal(bad.code, 3); assert.equal(bad.json.error.code, 'IDEA_NOT_FOUND');
    assert.match(doneText2, /公积金/); assert.match(doneText2, /CLI · Claude Code/);
    assert.ok(added.some(r => r.action === 'idea.complete' && r.kind === 'manual' && r.changes.includes('活跃池→已完成')));
    assert.ok(added.some(r => r.action === 'idea.uncomplete' && r.changes.includes('已完成→活跃池')));
    assert.ok(added.some(r => r.action === 'auto.complete_idea' && r.kind === 'cli' && r.agent === 'Claude Code'));
    return { toast, history: added, cli: { done: done.json.result.data, againNoop: again.json.result.data.noop, find: found.json.result.ideas.map(i => i.pool), bad: bad.json.error.code } };
  },
  /** D1 小窗口：写新事件 → 自动完成往下展开 → 先选分类再回车 → 记到所选分类；改名不出自动完成。 */
  async miniSmall() {
    const page = await main(), before = (await history()).length;
    await page.click('.tab-btn', '首页'); await sleep(300);
    await page.click('button.mini-toggle', '小窗口');
    const m = await mini();
    await m.waitFor(`!!document.querySelector('.mini-title')`, 10_000, 'mini title');
    // 刚显示的窗口要等系统焦点到了再点（同用户点窗口时，窗口先激活再收到点击）
    await m.waitFor('document.hasFocus()', 5000, 'mini focused').catch(() => null);
    await sleep(600);
    const g0 = await geo(m);
    await press(m, '.mini-title'); await sleep(900);
    const g1 = await geo(m);
    await m.shot(join(shots, '06-d1-small-writing-suggest.png'));
    await press(m, '#mini-project'); await sleep(500);
    const g2 = await geo(m);
    await m.shot(join(shots, '07-d1-small-category-list.png'));
    await press(m, '.mini-cat-list li', '学习'); await sleep(300);
    const chosen = (await geo(m)).cat;
    await m.eval(`document.querySelector('#mini-name').focus()`);
    await m.type('隔离验收：读书'); await sleep(200); await enter(m); await sleep(1200);
    const g3 = await geo(m);
    await m.shot(join(shots, '08-d1-small-started.png'));
    // 改名：不出自动完成
    await m.click('.mini-title'); await sleep(700);
    const g4 = await geo(m);
    await m.key('Escape'); await sleep(500);
    const added = await newSince(before), started = added.find(r => r.action === 'mini.editOpen');
    assert.ok(g1.pop?.sug && !g1.pop.up, 'suggest opens downward'); assert.ok(g1.h > g0.h + 100, 'window grew');
    assert.ok(Math.abs(g1.barTop - g0.barTop) <= 1, 'bar did not move');
    assert.ok(g2.pop?.cat, 'category list'); assert.equal(chosen, '学习');
    assert.equal(g3.title, '隔离验收：读书'); assert.equal(g3.cat, '学习'); assert.equal(g3.pop, null);
    assert.ok(Math.abs(g3.h - g0.h) <= 2, 'collapsed back');
    assert.equal(g4.pop, null, 'rename shows no suggestions');
    assert.ok(started && started.source.via === 'mini', 'mini.editOpen recorded from mini');
    // 从待确认开始的新条目：历史的主体是被截断的待机，新条目在连带里（与 beta.3 主窗口开始计时相同）
    assert.ok([...started.changes, ...started.effects].some(c => c.type === 'entry' && c.field === '项目' && c.after === '学习'), 'new entry logged to 学习');
    return { g0, g1, g2, g3, g4, history: added.map(r => `${r.action}@${r.source.via}`) };
  },
  /** D1 弹层自适应：小窗挪到屏幕底边，写新事件时弹层翻到上面、本体不动；选中最近的记录后收起复位。 */
  async miniUp() {
    const page = await main(), m = await mini(), before = (await history()).length;
    // 先暂停，回到可写新事件的状态
    await m.click('.mini-btn[aria-label="暂停"]'); await sleep(900);
    const g0 = await geo(m);
    const y = Math.round((g0.availTop + g0.availH - g0.h) * g0.dpr) - 4, x = Math.round(g0.x * g0.dpr);
    const moved = await page.invoke('plugin:window|set_position', { label: 'mini', value: { Physical: { x, y } } }).then(() => true, e => String(e));
    await sleep(800);
    const g1 = await geo(m);
    await m.click('.mini-title'); await sleep(1000);
    const g2 = await geo(m);
    await m.shot(join(shots, '09-d1-bottom-flip-up.png'));
    await m.type('读'); await sleep(500);
    const items = await m.eval(`[...document.querySelectorAll('.mini-pop .sug-i span')].map(s => s.textContent)`);
    await press(m, '.mini-pop .sug-i', '隔离验收：读书'); await sleep(1200);
    const g3 = await geo(m);
    await m.shot(join(shots, '10-d1-bottom-after-pick.png'));
    const added = await newSince(before);
    assert.equal(moved, true, `moved mini: ${moved}`);
    assert.ok(g2.pop?.up, 'popup flipped up'); assert.ok(g2.y < g1.y - 100, 'window grew upward');
    assert.ok(Math.abs(g2.barTop - g1.barTop) <= 1, 'bar stayed in place');
    assert.ok(g2.y >= g2.availTop - 1, 'within work area');
    assert.ok(items.includes('隔离验收：读书'));
    assert.equal(g3.pop, null); assert.ok(Math.abs(g3.y - g1.y) <= 1 && Math.abs(g3.h - g1.h) <= 2, 'collapsed back to the bar position');
    assert.equal(g3.title, '隔离验收：读书'); assert.equal(g3.cat, '学习');
    assert.ok(added.some(r => r.action === 'mini.continueEntry' && r.source.via === 'mini'));
    return { g1, g2, g3, items, history: added.map(r => `${r.action}@${r.source.via}`) };
  },
  /** D1 mini窗口：没有「×」、读数 16px、分类块；点分类块改正在计的这一条；长分类名省略。 */
  async miniTiny() {
    const page = await main(), m = await mini(), before = (await history()).length;
    await page.click('.tab-btn', '设置'); await sleep(400);
    await page.click('.s-item', '窗口与数据'); await sleep(400);
    await page.click('.seg[aria-label="小窗口样式"] button', 'mini窗口'); await sleep(1500);
    const g0 = await geo(m);
    await m.shot(join(shots, '11-d1-tiny-running.png'));
    await press(m, '#mini-cat'); await sleep(500);
    const g1 = await geo(m);
    await m.shot(join(shots, '12-d1-tiny-category-list.png'));
    await press(m, '.mini-cat-list li', '工作'); await sleep(1000);
    const g2 = await geo(m);
    // 写新事件：暂停后点名字，出自动完成，选收藏以外的待做卡没有就选最近的记录
    await m.click('.mini-btn[aria-label="暂停"]'); await sleep(800);
    await m.click('.mini-title'); await sleep(900);
    const g3 = await geo(m);
    await m.shot(join(shots, '13-d1-tiny-writing-suggest.png'));
    await m.key('Escape'); await sleep(800);
    const g4 = await geo(m);
    const added = await newSince(before);
    assert.equal(g0.close, false, 'no close button'); assert.equal(g0.timeFont, '16px');
    assert.equal(g0.cat, '学习'); assert.ok(g1.pop?.cat);
    assert.equal(g2.cat, '工作');
    assert.ok(g3.pop?.sug, 'tiny suggestions');
    assert.equal(g4.pop, null);
    assert.ok(added.some(r => r.action === 'mini.editOpen' && r.changes.some(c => c.field === '项目' && c.after === '工作')));
    return { g0, g1, g2, g3, g4, history: added.map(r => `${r.action}@${r.source.via ?? r.source.kind}`) };
  },
  /** 关小窗时弹层开着：再打开回到本体的大小和位置。 */
  async miniHideExpanded() {
    const page = await main(), m = await mini();
    await page.click('.tab-btn', '首页'); await sleep(300);
    await m.click('.mini-title'); await sleep(900);
    const open = await geo(m);
    await page.click('button.mini-toggle', '小窗口'); await sleep(1200);
    const file = JSON.parse(await readFile(join(env.profile, 'mini-window.json'), 'utf8'));
    await page.click('button.mini-toggle', '小窗口'); await sleep(1500);
    const reopened = await geo(m);
    const before = (await history()).length;
    assert.ok(open.pop, 'was expanded'); assert.equal(reopened.pop, null, 'editor left when hidden');
    assert.ok(reopened.h < open.h - 100, 'collapsed after reopening');
    assert.ok(Math.abs(reopened.barTop - open.barTop) <= 1, 'reopened at the bar position');
    assert.ok(file.height <= Math.ceil(reopened.h * reopened.dpr) + 2, 'saved bar height, not the expanded height');
    return { open, reopened, saved: file, historyAfter: before };
  },
  async finish() {
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
  try { results[name] = { ok: true, ms: Date.now() - t0, ...await steps[name]() }; results[name].ms = Date.now() - t0; console.log('PASS', name); }
  catch (error) { results[name] = { ok: false, ms: Date.now() - t0, error: String(error?.stack ?? error) }; console.log('FAIL', name, String(error)); }
  await save();
}
for (const p of [ctx.main, ctx.mini]) p?.close?.();
process.exit(0);

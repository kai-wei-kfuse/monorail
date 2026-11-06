// 0.3.1 隔离真窗口第二批：G7 界面（插入卡、背包抽屉、排进今天、翻卡、缩小对话框、任务模式关掉）。照 run.mjs 的写法，CDP 驱动真窗口。
// 用法：node evidence/0.3.1-isolated/run-g7.mjs [步骤名…]。结果写 results-g7.json，截图写 shots-g7/。
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { parse, stringify } from 'yaml';
import { baseline, connect, count, here, kill, launch, loadEnv, sleep } from './lib.mjs';

const env = await loadEnv(), PORT = 19393, shots = join(here, 'shots-g7');
await mkdir(shots, { recursive: true });
const resultsPath = join(here, 'results-g7.json');
const results = existsSync(resultsPath) ? JSON.parse(await readFile(resultsPath, 'utf8')) : {};
const save = () => writeFile(resultsPath, JSON.stringify(results, null, 2));
const ctx = {};
async function history() {
  const dir = join(env.data, 'history'), out = [];
  if (!existsSync(dir)) return out;
  for (const day of await readdir(dir)) for (const f of await readdir(join(dir, day))) out.push(JSON.parse(await readFile(join(dir, day, f), 'utf8')));
  return out.sort((a, b) => a.at.localeCompare(b.at));
}
async function main() { if (!ctx.main) ctx.main = await connect(PORT, 'main'); return ctx.main; }
function cli(args) {
  const r = spawnSync(process.execPath, [env.cli, ...args], { encoding: 'utf8', env: { ...process.env, CLAUDECODE: '', CODEX_SANDBOX: '', MONORAIL_AGENT: '',
    MONORAIL_PIPE: env.pipe, MONORAIL_CONFIG_DIR: env.profile, MONORAIL_EXECUTABLE: env.exe } });
  return { code: r.status, out: r.stdout, err: r.stderr, json: (() => { try { return JSON.parse(r.stdout); } catch { return null; } })() };
}
const homeReady = `document.body.innerText.includes('首页') && !document.body.innerText.includes('正在打开数据目录')`;
const settingsPath = () => join(env.data, 'settings.yaml');
const setSettings = async patch => { const s = parse(await readFile(settingsPath(), 'utf8')); await writeFile(settingsPath(), stringify(patch(s))); };
const restart = async () => {
  ctx.main?.close(); ctx.main = null; kill(env.exe); await sleep(1200);
  launch(env.exe, PORT);
  const page = await main(); await page.waitFor(homeReady, 30_000, 'home'); await sleep(800); return page;
};
/** 真实鼠标：移到元素中间（悬停）；点击 */
async function hover(page, selector, text, dx = .5) {
  const r = await page.rect(selector, text); if (!r) throw new Error(`hover: ${selector} ${text ?? ''}`);
  await page.mouse('mouseMoved', r.x + r.w * dx, r.y + r.h / 2, 0); await sleep(500);
}
async function press(page, selector, text) {
  const r = await page.rect(selector, text); if (!r) throw new Error(`press: ${selector} ${text ?? ''}`);
  const x = r.x + r.w / 2, y = r.y + r.h / 2;
  await page.mouse('mouseMoved', x, y, 0); await page.mouse('mousePressed', x, y); await page.mouse('mouseReleased', x, y); await sleep(500);
}
const text = page => page.eval(`document.body.innerText`);

const steps = {
  /** 接着上一轮的数据重开（不重新迁移、不重建任务） */
  async reopen() { await restart(); return { processes: count(env.exe) }; },
  /** 启动：迁移、补项目和一个快捷活动，建一个主线任务（两项：时间盒 60、结果卡）和一个支线任务 */
  async boot() {
    kill(env.exe); launch(env.exe, PORT);
    let page = await main(); await page.waitFor(homeReady, 30_000, 'home');
    await setSettings(s => ({ ...s, lists: { ...s.lists, projects: [{ name: '学习', color: '#1aa3ff' }, { name: '工作', color: '#7c5cff' }],
      presets: [{ id: 'q-wc', name: '上厕所', project: '工作', tags: [], mode: '插入', place: '弹层' }] } }));
    page = await restart();
    await page.shot(join(shots, '01-boot.png'));
    const tabs = await page.eval(`[...document.querySelectorAll('.tab-btn')].map(b => b.textContent)`);
    assert.ok(!tabs.some(t => t.includes('背包')), 'no 背包 tab');
    assert.ok(!Object.keys(baseline().run).includes(env.productName), 'no isolated Run entry');
    return { tabs, processes: count(env.exe) };
  },
  /** 底栏〔背包〕拉开抽屉；新建主线任务（两项：时间盒 60、结果卡）；排进今天；Esc 收起 */
  async drawer() {
    const page = await main();
    await press(page, '.dock-toggle.bp-bag'); await sleep(500);
    assert.ok(await page.eval(`!!document.querySelector('.bp-drawer[data-open]')`), 'drawer open');
    await page.shot(join(shots, '02-drawer-empty.png'));
    await press(page, '.bq-new', '设定主线任务');
    await page.waitFor(`!!document.querySelector('#proj-name')`, 5000, 'task dialog');
    await page.eval(`document.querySelector('#proj-name').focus()`); await page.type('隔离测试：读龙书'); await sleep(200);
    await page.eval(`document.querySelector('#task-items-0').focus()`); await page.type('第 3 章'); await sleep(200);
    await press(page, '.ie-row.typed [role=radio]', '时间盒');
    await press(page, '.ie-foot .sbtn', '加一项');
    await page.eval(`document.querySelector('#task-items-1').focus()`); await page.type('写读书笔记'); await sleep(200);
    const minutes = await page.eval(`document.querySelector('.ie-min input')?.value`);
    await page.shot(join(shots, '03-new-task-typed-items.png'));
    await press(page, '.dlg .sbtn.ink', '放入'); await sleep(900);
    const cards = await page.eval(`[...document.querySelectorAll('.bq .bq-title')].map(e => e.textContent)`);
    assert.ok(cards.includes('隔离测试：读龙书'), 'quest card shown');
    // 排进今天：浮层，时间盒默认剩下的时长
    await press(page, '.bq .bp-btn', '排进今天');
    const popText = await page.eval(`document.querySelector('.bp-pop')?.innerText.replace(/\\s+/g, ' ')`);
    await page.shot(join(shots, '04-plan-popover.png'));
    await press(page, '.bp-pop .sbtn.ink'); await sleep(900);
    const boardText = await page.eval(`document.querySelector('.bp-board')?.innerText.replace(/\\s+/g, ' ')`);
    await page.shot(join(shots, '05-board-one-item.png'));
    assert.match(boardText, /第 3 章/); assert.match(boardText, /0:00 \/ 1:00/);
    // 详情：第二项也排进今天
    await press(page, '.bq .bp-more'); await sleep(400);
    await page.shot(join(shots, '06-detail.png'));
    await press(page, '.bp-it .bp-btn', '排进今天'); await press(page, '.bp-pop .sbtn.ink'); await sleep(800);
    await press(page, '.bp-backlink'); await sleep(300);
    // Esc 收起
    await page.key('Escape'); await sleep(600);
    const closed = await page.eval(`!document.querySelector('.bp-drawer[data-open]')`);
    const plans = existsSync(join(env.data, 'plans')) ? await readdir(join(env.data, 'plans')) : [];
    const planFile = plans.length ? parse(await readFile(join(env.data, 'plans', plans[0]), 'utf8')) : null;
    assert.equal(closed, true); assert.equal(planFile?.items?.length, 2);
    assert.equal(minutes, '60');
    return { cards, popText, boardText, planItems: planFile.items.map(i => ({ card: i.card_id.slice(0, 8), today_minutes: i.today_minutes })), defaultMinutes: minutes };
  },
  /** 抽一张：翻卡（截三帧），〔开始〕开始抽到的那张；抽屉收起 */
  async flip() {
    const page = await main();
    await press(page, '.dock-toggle.bp-bag'); await sleep(500);
    await press(page, '.bp-draw'); await sleep(300);
    await page.shot(join(shots, '07-flip-deal.png'));
    await page.waitFor(`!!document.querySelector('.fd-cap.on')`, 8000, 'flip done');
    const deal = await page.eval(`document.querySelector('.fd-deal')?.innerText.replace(/\\s+/g, ' ')`);
    await page.shot(join(shots, '08-flip-open.png'));
    assert.ok(!/%/.test(deal), 'no odds shown');
    await press(page, '.fd-cap button.go'); await sleep(1200);
    const state = parse(await readFile(join(env.data, 'state.yaml'), 'utf8'));
    await page.shot(join(shots, '09-card-started.png'));
    assert.ok(state.current_card, 'card started');
    const home = await page.eval(`document.querySelector('.card')?.innerText.replace(/\\s+/g, ' ').slice(0, 200)`);
    return { deal, currentCard: state.current_card.slice(0, 8), home };
  },
  /** 做卡中插入「上厕所」（快捷活动）：插入卡，鼠标放回去区域左边 / 右边，暂停 / 继续，〔回到任务〕 */
  async insert() {
    const page = await main();
    await press(page, '.dock-toggle', '快捷活动'); await sleep(400);
    await press(page, '.tray .act-tile, .tray button', '上厕所'); await sleep(1500);
    assert.ok(await page.eval(`!!document.querySelector('.ins-top')`), 'insert card');
    await page.shot(join(shots, '10-inserting.png'));
    await hover(page, '.ins-up-back', undefined, .3); await sleep(400);
    await page.shot(join(shots, '11-hover-back.png'));
    await hover(page, '.ins-up-end'); await sleep(500);
    await page.shot(join(shots, '12-hover-end.png'));
    await page.mouse('mouseMoved', 10, 10, 0); await sleep(300);
    const chip = await page.eval(`document.querySelector('.ins-chip')?.innerText`);
    await press(page, '.ins-top .abtn', '暂停'); await sleep(900);
    const paused = await page.eval(`document.querySelector('.ins-top .readout')?.innerText.replace(/\\s+/g, ' ')`);
    await page.shot(join(shots, '13-insert-paused.png'));
    await press(page, '.ins-top .abtn', '继续'); await sleep(900);
    const resumed = await page.eval(`document.querySelector('.ins-top .readout')?.innerText.replace(/\\s+/g, ' ')`);
    await press(page, '.ins-up-back'); await sleep(1500);
    const backHome = await page.eval(`!document.querySelector('.ins-top')`);
    await page.shot(join(shots, '14-back-to-task.png'));
    const recs = (await history()).map(r => r.action).filter(a => /insert|pause|continue|resume|startPreset/.test(a));
    assert.match(paused, /已暂停/); assert.match(resumed, /插入中/); assert.equal(backHome, true);
    return { chip, paused, resumed, history: recs };
  },
  /** 缩小：时间盒那张卡拆成两份；详情里出现「剩下的」 */
  async shrink() {
    const page = await main();
    await press(page, '.abtn', '缩小'); await page.waitFor(`!!document.querySelector('.shr')`, 5000, 'shrink dialog');
    await page.eval(`document.querySelector('#split-today').focus()`); await page.type('3.1–3.3'); await sleep(200);
    await page.shot(join(shots, '15-shrink-dialog.png'));
    await press(page, '.dlg .sbtn.ink', '缩小'); await sleep(1000);
    await press(page, '.dock-toggle.bp-bag'); await sleep(400);
    await press(page, '.bq .bp-more'); await sleep(400);
    const detail = await page.eval(`document.querySelector('.bp-detail')?.innerText.replace(/\\s+/g, ' ')`);
    await page.shot(join(shots, '16-detail-after-shrink.png'));
    await page.key('Escape'); await sleep(200); await page.key('Escape'); await sleep(500);
    assert.match(detail, /SHRINK/);
    return { detail: detail.slice(0, 300) };
  },
  /** 任务模式关掉：抽屉只剩想法池；首页没有〔今日任务板〕；CLI start_task_item 报 TASK_MODE_OFF */
  async taskModeOff() {
    const page = await main();
    await page.click('.tab-btn', '设置'); await sleep(400);
    await page.click('.s-item', '任务模式'); await sleep(400);
    await press(page, '.tgl[aria-label="任务模式"]'); await sleep(800);
    await page.click('.tab-btn', '首页'); await sleep(500);
    await press(page, '.dock-toggle.bp-bag'); await sleep(500);
    const drawer = await page.eval(`document.querySelector('.bp-drawer')?.innerText.replace(/\\s+/g, ' ')`);
    // 提示里写着「任务和今日任务板都会回来」，不能按文字判断：看板子和任务页的元素在不在
    const hasBoard = await page.eval(`!!document.querySelector('.bp-drawer .bp-board') || !!document.querySelector('.bp-drawer .bq')`);
    await page.shot(join(shots, '17-taskmode-off-drawer.png'));
    await page.key('Escape'); await sleep(400);
    const ctxRes = cli(['context', '--json']);
    const cards = (await readdir(join(env.data, 'cards'))).filter(n => n.endsWith('.md'));
    const anyCard = cards[0]?.replace(/\.md$/, '');
    const bad = cli(['timer', 'start-item', anyCard, '--json']);
    // 打开回来
    await page.click('.tab-btn', '设置'); await sleep(300); await page.click('.s-item', '任务模式'); await sleep(300);
    await press(page, '.tgl[aria-label="任务模式"]'); await sleep(600);
    await page.click('.tab-btn', '首页'); await sleep(300);
    assert.equal(hasBoard, false, 'no board or quest cards when off');
    assert.equal(bad.json?.error?.code, 'TASK_MODE_OFF');
    return { drawer: drawer.slice(0, 160), todayPlanWhenOff: ctxRes.json?.result?.today_plan ?? null, startItem: bad.json?.error?.code };
  },
  /** 缩小以后读数对得上（第一轮看到大读数 24:30、累计 0:00）：等几秒再读，大读数 ≤ 累计 */
  async readoutAfterSplit() {
    const page = await main();
    await page.click('.tab-btn', '首页'); await sleep(2500);
    const read = await page.eval(`[document.querySelector('.card .digits')?.textContent, document.querySelector('.c-total')?.textContent].join(' | ')`);
    await page.shot(join(shots, '18-readout-after-split.png'));
    const [big, total] = read.split(' | ');
    const ms = t => { const p = t.trim().split(':').map(Number); return p.length === 3 ? ((p[0] * 60 + p[1]) * 60 + p[2]) * 1000 : (p[0] * 60 + p[1]) * 1000; };
    const m = total.match(/(\d+):(\d+)/), totalMin = m ? Number(m[1]) * 60 + Number(m[2]) : 0;
    assert.ok(ms(big) <= (totalMin + 1) * 60_000, `big readout ${big} should not exceed total ${total}`);
    return { read };
  },
  async finish() {
    ctx.main?.close(); ctx.main = null; kill(env.exe); await sleep(800);
    const after = baseline(), before = JSON.parse(await readFile(join(here, 'baseline-before.json'), 'utf8'));
    await writeFile(join(here, 'baseline-after-g7.json'), JSON.stringify(after, null, 2));
    const all = await history();
    await writeFile(join(here, 'history-records-g7.json'), JSON.stringify(all, null, 2));
    return { runSame: JSON.stringify(before.run) === JSON.stringify(after.run), dailyExeSame: before.daily.exe === after.daily.exe,
      dailyConfigSame: before.daily.config === after.daily.config, dailyPid: [before.daily.pid, after.daily.pid], historyCount: all.length,
      actions: [...new Set(all.map(r => r.action))] };
  },
};

const order = Object.keys(steps), wanted = process.argv.slice(2).length ? process.argv.slice(2) : order;
for (const name of wanted) {
  const t0 = Date.now();
  try { results[name] = { ok: true, ...await steps[name]() }; results[name].ms = Date.now() - t0; console.log('PASS', name); }
  catch (error) { results[name] = { ok: false, ms: Date.now() - t0, error: String(error?.stack ?? error) }; console.log('FAIL', name, String(error).slice(0, 300));
    try { await ctx.main?.shot(join(shots, `fail-${name}.png`)); } catch {} }
  await save();
}
ctx.main?.close?.();
process.exit(0);

// 0.3.0-beta.3 隔离真窗口实测（执行方案 §4.4）：隔离身份的 debug exe + WebView2 CDP 驱动真窗口，MCP / CLI 走隔离管道。
// 用法：node evidence/beta3-isolated/run.mjs [步骤名…]（不给就全跑）。结果写 results.json，截图写 shots/。
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { Client as LegacyClient } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport as LegacyHttp } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { startHttp } from '../../mcp/http.ts';
import { createPipeApplicationClient } from '../../client/applicationClient.ts';
import { baseline, connect, count, evidenceLines, here, kill, launch, loadEnv, sleep } from './lib.mjs';

const env = await loadEnv(), PORT = 19371, shots = join(here, 'shots');
await mkdir(shots, { recursive: true });
const resultsPath = join(here, 'results.json');
const results = existsSync(resultsPath) ? JSON.parse(await readFile(resultsPath, 'utf8')) : {};
const save = () => writeFile(resultsPath, JSON.stringify(results, null, 2));
const ctx = {};   // 步骤之间共享（卡片 ID 等）

async function history() {
  const dir = join(env.data, 'history'), out = [];
  if (!existsSync(dir)) return out;
  for (const day of await readdir(dir)) for (const f of await readdir(join(dir, day))) out.push(JSON.parse(await readFile(join(dir, day, f), 'utf8')));
  return out.sort((a, b) => a.at.localeCompare(b.at));
}
const newSince = async n => (await history()).slice(n);
const setInput = (selector, value, pick = 'true') => `(() => { const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find(e => ${pick});
  if (!el) return false; el.focus(); const p = Object.getPrototypeOf(el); Object.getOwnPropertyDescriptor(p, 'value').set.call(el, ${JSON.stringify(value)});
  el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`;
async function main() {
  if (!ctx.main || ctx.main.dead) { ctx.main = await connect(PORT, 'main'); }
  return ctx.main;
}
async function mcpStdio(name, version, work) {
  const client = new Client({ name, version }, { versionNegotiation: { mode: 'auto' } });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [env.mcp], env: { ...process.env, MONORAIL_MCP_PIPE: env.pipe, MONORAIL_MCP_CONFIG_DIR: env.profile, MONORAIL_MCP_EXECUTABLE: env.exe } }));
  try { return await work(client); } finally { await client.close(); }
}
const tool = async (client, name, args) => { const r = await client.callTool({ name, arguments: args }); return r.structuredContent; };
function cli(args, extraEnv = {}) {
  const r = spawnSync(process.execPath, [env.cli, ...args], { encoding: 'utf8', env: { ...process.env, CLAUDECODE: '', CODEX_SANDBOX: '', MONORAIL_AGENT: '', ...extraEnv,
    MONORAIL_PIPE: env.pipe, MONORAIL_CONFIG_DIR: env.profile, MONORAIL_EXECUTABLE: env.exe } });
  return { code: r.status, out: r.stdout, err: r.stderr, json: (() => { try { return JSON.parse(r.stdout); } catch { return null; } })() };
}

const steps = {
  async boot() {
    kill(env.exe);
    launch(env.exe, PORT);
    const page = await main();
    await page.waitFor(`document.body.innerText.includes('首页') && !document.body.innerText.includes('正在打开数据目录')`, 30_000, 'home');
    await sleep(800);
    const ev = await evidenceLines(env.profile);
    const run = baseline().run;
    await page.shot(join(shots, '01-boot-home.png'));
    assert.ok(ev.some(e => e.message.startsWith('connected:')), 'connected evidence');
    assert.ok(!Object.keys(run).includes(env.productName), 'no isolated Run entry');
    return { title: await page.eval('document.title'), processes: count(env.exe), connected: ev.find(e => e.message.startsWith('connected:')).message, runEntryAdded: false };
  },
  async d6() {
    const page = await main();
    await page.click('button.dock-toggle', '快捷活动');
    const tray = await page.waitFor(`document.querySelector('.tray')?.innerText`, 5000, 'tray');
    await page.shot(join(shots, '02-d6-quickacts.png'));
    await page.click('button.dock-toggle', '快捷活动');
    assert.ok(!tray.includes('睡觉'), 'no 睡觉 tile');
    return { tray: tray.replace(/\s+/g, ' ') };
  },
  async automation() {
    const before = (await history()).length;
    // MCP 新协议 stdio，clientInfo 用 Claude Desktop 公开的默认名（不是真客户端）：捕获待办 → 得到卡片
    const a = await mcpStdio('claude-ai', '0.14.2', async c => {
      const g = await tool(c, 'get_context', {});
      const todo = await tool(c, 'capture_todo', { operation_id: g.operation_id, text: '隔离验收：小窗完成这张卡' });
      const g2 = await tool(c, 'get_context', {});
      const bad = await c.callTool({ name: 'pause_timer', arguments: { operation_id: g2.operation_id, expected_state: 'ts1:stale' } });   // 被拒绝：不记
      const g3 = await tool(c, 'get_context', {});
      const started = await tool(c, 'start_task_item', { operation_id: g3.operation_id, expected_state: g3.expected_state, card_id: todo.data.card_id });
      return { cardId: todo.data.card_id, rejected: bad.isError === true, started: started.status };
    });
    ctx.cardId = a.cardId;
    // MCP 旧协议无状态 HTTP：记「MCP · 未识别」
    const http = await startHttp(createPipeApplicationClient(env.pipe, { configDir: env.profile, executable: env.exe }), { port: 0 });
    const legacy = new LegacyClient({ name: 'legacy-http-client', version: '1' });
    try {
      await legacy.connect(new LegacyHttp(http.url));
      const g = (await legacy.callTool({ name: 'get_context', arguments: {} })).structuredContent;
      await legacy.callTool({ name: 'save_idea', arguments: { operation_id: g.operation_id, text: '隔离验收：旧协议 HTTP 存的想法' } });
    } finally { await legacy.close(); await http.close(); }
    // CLI：--agent、已知环境变量、都没有
    const c1 = cli(['--agent', '手环同步', 'time', 'add', '隔离验收：晨跑', '--start', new Date(Date.now() - 5 * 3600_000).toISOString().replace('Z', '+00:00'),
      '--end', new Date(Date.now() - 4.5 * 3600_000).toISOString().replace('Z', '+00:00'), '--json']);
    const c2 = cli(['idea', 'add', '隔离验收：Claude Code 存的想法', '--json'], { CLAUDECODE: '1' });
    const c3 = cli(['idea', 'add', '隔离验收：未识别的 CLI', '--json']);
    const c4 = cli(['context', '--json']);   // 只读：不记
    const added = await newSince(before);
    const src = added.map(r => ({ action: r.action, kind: r.source.kind, agent: r.source.agent ?? null, method: r.call?.method }));
    const find = (method, kind) => src.find(s => s.method === method && s.kind === kind);
    assert.ok(a.rejected, 'stale expected_state rejected');
    assert.equal(find('capture_todo', 'mcp')?.agent?.raw, 'claude-ai');
    assert.equal(find('capture_todo', 'mcp')?.agent?.name, 'Claude Desktop');
    assert.equal(find('save_idea', 'mcp')?.agent?.detected_by, 'none');
    assert.equal(find('add_time_entry', 'cli')?.agent?.name, '手环同步');
    assert.equal(src.find(s => s.kind === 'cli' && s.agent?.detected_by === 'env')?.agent?.name, 'Claude Code');
    assert.ok(src.some(s => s.kind === 'cli' && s.agent?.detected_by === 'none'));
    assert.ok(!src.some(s => s.method === 'pause_timer' || s.method === 'get_context'), 'rejected / read-only not recorded');
    return { cliExit: [c1.code, c2.code, c3.code, c4.code], records: src };
  },
  async mini() {
    const page = await main(), before = (await history()).length;
    await page.click('button.mini-toggle', '小窗口');
    const mini = await connect(PORT, 'mini');
    await mini.waitFor(`!!document.querySelector('.mini-btn[aria-label="完成"]')`, 10_000, 'mini complete button');
    await mini.shot(join(shots, '03-mini-running.png'));
    await mini.click('.mini-btn[aria-label="完成"]');
    await page.waitFor(`[...document.querySelectorAll('.sbtn.ink')].some(b => b.textContent === '完成')`, 10_000, 'complete dialog');
    await page.shot(join(shots, '04-mini-complete-dialog.png'));
    await page.click('.sbtn.ink', '完成');
    await sleep(1200);
    const added = await newSince(before), done = added.find(r => r.action === 'card.complete');
    ctx.mini = mini;
    assert.ok(done, 'card.complete recorded');
    assert.deepEqual(done.source, { kind: 'manual', via: 'mini' });
    assert.ok(!added.some(r => r.action === 'mini.complete'), 'mini command itself not recorded');
    return { complete: { source: done.source, subject: done.subject } };
  },
  async d4() {
    const page = await main(), mini = ctx.mini ?? await connect(PORT, 'mini');
    const samples = [];
    for (const round of [1, 2]) {
      await page.call('Page.reload', { ignoreCache: false });
      page.dead = true;
      const t0 = Date.now();
      for (let i = 0; i < 12; i++) { await sleep(500); samples.push({ round, ms: Date.now() - t0, text: (await mini.text()).replace(/\s+/g, ' ').slice(0, 60) }); }
      ctx.main = null;
      await (await main()).waitFor(`document.body.innerText.includes('首页')`, 20_000);
    }
    await mini.shot(join(shots, '05-d4-mini-after-f5x2.png'));
    const bad = samples.filter(s => s.text.includes('主窗口未响应'));
    const recovered = samples.filter(s => s.round === 2).find(s => !s.text.includes('等主窗口') && !s.text.includes('未响应'));
    assert.equal(bad.length, 0, 'mini never shows 主窗口未响应');
    assert.ok(recovered && recovered.ms <= 3000, 'mini recovered within 3s');
    return { samples, recoveredMs: recovered.ms };
  },
  async quickbar() {
    const page = await main(), before = (await history()).length;
    await page.invoke('show_quickbar');
    const qb = await connect(PORT, 'quickbar');
    await qb.waitFor(`!!document.querySelector('.qb-input')`, 10_000);
    await qb.eval(setInput('.qb-input', '隔离验收：快速记录条的待办'));
    await sleep(200);
    await qb.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await qb.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await sleep(2500);
    const added = await newSince(before), cap = added.find(r => r.action === 'quickbar.capture' || r.action === 'quickbar.idea');
    assert.ok(cap, 'quickbar history');
    assert.deepEqual(cap.source, { kind: 'manual', via: 'quickbar' });
    const rec = cap.subject.id, file = await readFile(join(env.data, 'records', `${rec}.md`), 'utf8');
    assert.match(file, /created_via: quickbar/); assert.match(file, /history_logged_at:/);
    return { action: cap.action, subject: cap.subject, others: added.filter(r => r !== cap).map(r => r.action) };
  },
  async calendar() {
    const page = await main(), before = (await history()).length;
    await page.click('button.tab-btn', '日历');
    await page.waitFor(`!!document.querySelector('.cal-col.today')`, 10_000);
    await page.click('.seg button', '日'); await page.click('.seg button', '今天').catch(() => {}); await page.click('.seg button', '1×');
    await sleep(500);
    // 日视图 1×，在 05:30 那条线往下 1px 按下、拖 1.2 分钟的像素（过去的空白处；4 个比例的分步实测见 probe-drag.mjs）
    const geo = await page.eval(`(() => { [...document.querySelectorAll('.cal-hours span')].find(s => s.textContent === '05:00').scrollIntoView({ block: 'center' });
      const col = document.querySelector('.cal-col'), r = col.getBoundingClientRect(), hourPx = parseFloat(getComputedStyle(document.querySelector('.cal-grid')).getPropertyValue('--hour-px'));
      return { x: r.x + r.width / 2, top: r.y, hourPx, ratio: devicePixelRatio }; })()`);
    const top = await page.eval(`document.querySelector('.cal-col').getBoundingClientRect().y`);
    const y = top + 1.5 * geo.hourPx + 1, minutePx = geo.hourPx / 60;
    await page.mouse('mousePressed', geo.x, y); await page.mouse('mouseMoved', geo.x, y + minutePx * 0.6); await page.mouse('mouseMoved', geo.x, y + minutePx * 1.2);
    await page.mouse('mouseReleased', geo.x, y + minutePx * 1.2);
    await sleep(1200);
    const created = (await newSince(before)).find(r => r.action === 'entry.create');
    assert.ok(created, 'entry.create');
    const time = created.changes.find(c => c.field === '时间')?.after;
    const [, s, e] = /(\d\d:\d\d)–(\d\d:\d\d)/.exec(time);
    const mins = (h => (h(e) - h(s) + 1440) % 1440)(t => +t.slice(0, 2) * 60 + +t.slice(3));
    assert.ok(mins >= 1 && mins <= 2, `1-minute drag created ${mins} min`);
    await page.shot(join(shots, '06-d2-one-minute.png'));
    // D3：弹窗里把时长改成 45:00
    const pop = await page.waitFor(`!!document.querySelector('.cal-pop')`, 3000).catch(() => false);
    if (!pop) await page.click('.blk', created.subject.text);
    await page.waitFor(`!!document.querySelector('.cal-pop .cal-dur')`, 5000, 'popover');
    await page.eval(setInput('.cal-pop .cal-dur', '20:00'));
    await page.key('Enter');
    await sleep(900);
    const upd = (await newSince(before)).find(r => r.action === 'entry.setDuration');
    await page.shot(join(shots, '07-d3-popover-duration.png'));
    assert.ok(upd, 'entry.setDuration');
    assert.equal(upd.source.page, 'calendar');
    const popText = await page.eval(`document.querySelector('.cal-pop')?.innerText ?? ''`);
    await page.key('Escape');
    ctx.entryId = created.subject.id;
    return { geo, createdMinutes: mins, created: time, setDuration: upd.changes.map(c => `${c.field}: ${c.before} → ${c.after}`), popText: popText.replace(/\s+/g, ' ') };
  },
  async list() {
    const page = await main(), before = (await history()).length;
    await page.click('button.tab-btn', '列表');
    await page.waitFor(`!!document.querySelector('.lv-din')`, 10_000);
    const ok = await page.eval(setInput('.lv-din', '隔离验收：列表里改的描述', `!e.readOnly && (e.value ?? '').includes('晨跑')`));
    assert.ok(ok, 'editable row');
    await page.key('Enter');
    await sleep(900);
    const p = (await newSince(before)).find(r => r.action === 'entry.patch');
    assert.ok(p, 'entry.patch'); assert.equal(p.source.page, 'list');
    return { patch: p.changes.map(c => `${c.field}: ${c.before} → ${c.after}`), source: p.source };
  },
  async settings() {
    const page = await main(), before = (await history()).length;
    await page.click('button.tab-btn', '设置');
    await page.click('button.s-item', '外观');
    await page.click('.sw-row button[aria-label="天青"]'); await sleep(600);
    await page.click('.sw-row button[aria-label="警示橙"]'); await sleep(600);
    const added = await newSince(before), all = await history();
    const merged = all.filter(r => r.action === 'settings.change' && r.subject?.id === 'accent');
    assert.equal(merged.length, 1, 'two accent changes merged into one record');
    assert.equal(merged[0].merged, 2);
    await page.click('.sw-row button[aria-label="薄荷绿"]'); await sleep(600);
    const back = (await history()).filter(r => r.action === 'settings.change' && r.subject?.id === 'accent');
    return { newFiles: added.length, merged: merged[0].merged, changes: merged[0].changes, afterRevert: back.map(r => ({ merged: r.merged, reverted: r.reverted ?? false, changes: r.changes.length })) };
  },
  async historyView() {
    const page = await main();
    await page.click('button.tab-btn', '列表');
    await page.click('.seg button', '操作历史');
    await page.waitFor(`!!document.querySelector('.oh-row')`, 10_000, 'history rows');
    await sleep(500);
    await page.shot(join(shots, '10-history-all.png'));
    const rows = await page.eval(`[...document.querySelectorAll('.oh-row')].map(r => r.innerText.replace(/\\s+/g, ' '))`);
    await page.click('.oh-seg button', '仅自动化');
    await page.click('.oh-sel-btn');
    const agents = await page.eval(`[...document.querySelectorAll('.oh-sel-pop li')].map(l => l.innerText.replace(/\\s+/g, ' '))`);
    await page.shot(join(shots, '11-history-auto-agents.png'));
    await page.key('Escape');
    await page.click('.oh-sel-pop li, .oh-sel-btn').catch(() => {});
    await page.eval(`document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`);
    const cliRow = await page.eval(`(() => { const r = [...document.querySelectorAll('.oh-row')].find(r => r.innerText.includes('手环同步')); r?.click(); return !!r; })()`);
    await sleep(400);
    const detail = await page.eval(`document.querySelector('.oh-detail')?.innerText ?? ''`);
    await page.shot(join(shots, '12-history-cli-detail.png'));
    // 复制 operation_id（Tauri 里的剪贴板）
    await page.call('Page.bringToFront');
    await page.click('.oh-detail .sbtn', '复制 ID');
    await sleep(400);
    const clip = execFileSync('powershell.exe', ['-NoProfile', '-Sta', '-Command', '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Get-Clipboard -Raw'], { encoding: 'utf8' }).trim();
    const opId = /operation_id\s+(\S+)/.exec(detail)?.[1];
    // ◎ 定位：日历那条新建条目 → 日历日视图
    await page.click('.oh-seg button', '全部');
    const located = await page.eval(`(() => { const r = [...document.querySelectorAll('.oh-item')].find(i => i.innerText.includes('新建计时条目')); r?.querySelector('.oh-loc')?.click(); return !!r; })()`);
    await sleep(800);
    const calView = await page.eval(`({ tab: document.querySelector('.tab-btn[aria-selected="true"]')?.innerText, cols: document.querySelectorAll('.cal-col').length })`);
    await page.shot(join(shots, '13-locate-calendar.png'));
    // 窄窗口 960
    await page.call('Emulation.setDeviceMetricsOverride', { width: 960, height: 600, deviceScaleFactor: 1, mobile: false });
    await page.click('button.tab-btn', '列表'); await page.click('.seg button', '操作历史').catch(() => {});
    await sleep(500);
    const scroll = await page.eval(`({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, pw: document.querySelector('.page')?.scrollWidth, pc: document.querySelector('.page')?.clientWidth })`);
    await page.shot(join(shots, '14-history-960.png'));
    await page.call('Emulation.clearDeviceMetricsOverride');
    assert.ok(cliRow, 'cli row'); assert.ok(detail.includes('--agent'), 'cli command with --agent');
    assert.equal(clip, opId, 'clipboard has operation_id');
    assert.ok(located && calView.cols === 1, 'locate opens calendar day view');
    return { rows, agents, detail: detail.replace(/\s+/g, ' '), clipboardOk: clip === opId, calView, scroll };
  },
  async settings09() {
    const page = await main();
    await page.click('button.tab-btn', '设置');
    await page.click('button.s-item', 'AI 与自动化');
    await page.waitFor(`!!document.querySelector('.oh-recent li')`, 10_000, 'recent calls');
    await page.eval(`[...document.querySelectorAll('.s-group h3 b')].find(b => b.textContent === '最近调用')?.closest('.s-group').scrollIntoView({ block: 'start' })`);
    await sleep(300);
    await page.shot(join(shots, '15-settings09-recent.png'));
    const recent = await page.eval(`[...document.querySelectorAll('.oh-recent li')].map(l => l.innerText.replace(/\\s+/g, ' '))`);
    await page.click('.oh-recent li button');
    await sleep(900);
    const after = await page.eval(`({ tab: document.querySelector('.tab-btn[aria-selected="true"]')?.innerText, filter: document.querySelector('.oh-seg button[aria-checked="true"]')?.innerText, open: document.querySelectorAll('.oh-detail').length })`);
    await page.shot(join(shots, '16-settings09-jump.png'));
    assert.ok(recent.length >= 4); assert.match(after.filter, /仅自动化/); assert.ok(after.open >= 1);
    return { recent, after };
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
      actions: all.map(r => `${r.action}@${r.source.kind}${r.source.via ? '/' + r.source.via : ''}${r.source.page ? '/' + r.source.page : ''}`) };
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

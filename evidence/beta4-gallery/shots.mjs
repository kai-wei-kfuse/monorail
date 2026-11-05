// 0.3.0-beta.4 实现截图：gallery 里真的 MiniApp（假主窗口）和背包想法池。用法：node beta4-impl-shots.mjs <输出目录>
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const out = resolve(process.argv[2]); mkdirSync(out, { recursive: true });
const base = 'http://127.0.0.1:1420/gallery.html';
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--remote-debugging-port=9336',
  `--user-data-dir=${mkdtempSync(join(tmpdir(), 'cdp-'))}`, '--window-size=1400,900', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
const wait = ms => new Promise(r => setTimeout(r, ms));
let target;
for (let i = 0; i < 50 && !target; i++) {
  await wait(200);
  try { target = (await (await fetch('http://127.0.0.1:9336/json')).json()).find(t => t.type === 'page'); } catch { /* not up yet */ }
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r));
let id = 0; const pending = new Map();
ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJs = async expr => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;
const mouse = async (sel, type = 'mousePressed') => {
  const r = await evalJs(`(() => { const b = document.querySelector(${JSON.stringify(sel)})?.getBoundingClientRect(); return b && { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()`);
  if (!r) return false;
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: r.x, y: r.y });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: r.x, y: r.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: r.x, y: r.y, button: 'left', clickCount: 1 });
  return true;
};
const type = async text => { await send('Input.insertText', { text }); await wait(300); };
const shot = async name => { const { result } = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(out, `${name}.png`), Buffer.from(result.data, 'base64')); };
const go = async (url, w = 760, h = 700) => {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1.5, mobile: false });
  await send('Page.navigate', { url }); await wait(3500);
};
const log = [];
const state = async label => log.push(`${label}: ${JSON.stringify(await evalJs(`({ title: document.querySelector('.mini-title b')?.textContent ?? document.querySelector('#mini-name')?.value ?? null,
  cat: document.querySelector('.mini-cat span, .mini-pick')?.textContent ?? null, pop: document.querySelector('.mini-pop') ? (document.querySelector('.mini-pop .sug') ? 'suggest' : 'cat') : null,
  close: !!document.querySelector('[aria-label="关闭小窗口"]'), time: getComputedStyle(document.querySelector('.mini-time') ?? document.body).fontSize,
  items: [...document.querySelectorAll('.mini-pop li[role=option]')].map(n => n.textContent.trim()).join(' | ') })`))}`);
await send('Page.enable'); await send('Runtime.enable');

// mini窗口：计时中
await go(`${base}?page=mini&tiny`); await state('tiny-running'); await shot('01-mini窗口-计时中');
await mouse('#mini-cat'); await wait(300); await state('tiny-cat-open'); await shot('02-mini窗口-分类下拉');
await mouse('.mini-cat-list li:nth-child(3)'); await wait(400); await state('tiny-cat-picked');
// mini窗口：待机点名字写新事件 → 自动完成
await go(`${base}?page=mini&tiny&idle`); await mouse('.mini-title'); await wait(400); await state('tiny-writing'); await shot('03-mini窗口-写新事件-自动完成');
await type('投'); await state('tiny-filter'); await shot('04-mini窗口-写字筛选');
await mouse('.mini-pop .sug-i'); await wait(500); await state('tiny-picked-recent'); await shot('05-mini窗口-选中最近的记录');
// mini窗口：改名不出自动完成
await go(`${base}?page=mini&tiny`); await mouse('.mini-title'); await wait(400); await state('tiny-rename'); await shot('06-mini窗口-改名不出自动完成');
// mini窗口：长分类名
await go(`${base}?page=mini&tiny&long`); await state('tiny-long'); await shot('07-mini窗口-长分类名');
// 小窗口：写新事件，先选分类再回车
await go(`${base}?page=mini&idle`); await mouse('.mini-title'); await wait(400); await state('mini-writing'); await shot('08-小窗口-写新事件-记到与自动完成');
await mouse('#mini-project'); await wait(300); await state('mini-cat-open'); await shot('09-小窗口-写新事件-分类下拉');
await mouse('.mini-cat-list li:nth-child(3)'); await wait(300); await state('mini-cat-chosen');
await type('读书'); await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }); await wait(500);
await state('mini-started'); await shot('10-小窗口-回车后记到所选分类');
// 背包想法池
await go(`${base}?page=backpack&tab=ideas`, 1400, 860); await shot('11-想法池-完成按钮');
log.push(`ideas: ${JSON.stringify(await evalJs(`({ seg: [...document.querySelectorAll('.id-seg button')].map(b => b.textContent).join(' | '), done: document.querySelectorAll('.id-ok').length })`))}`);
await mouse('.id-seg button:nth-child(2)'); await wait(300); await shot('12-想法池-已完成列表');
log.push(`done: ${JSON.stringify(await evalJs(`[...document.querySelectorAll('.id-done')].map(n => n.textContent.trim()).join(' || ')`))}`);
await go(`${base}?page=backpack&tab=ideas&nodone`, 1400, 860); await mouse('.id-seg button:nth-child(2)'); await wait(300); await shot('13-想法池-已完成-空');
await go(`${base}?page=backpack&tab=ideas`, 960, 760); await shot('14-想法池-960');
log.push(`960 scrollX: ${await evalJs('document.documentElement.scrollWidth > innerWidth')}`);
writeFileSync(join(out, 'shots.log'), log.join('\n') + '\n');
console.log(log.join('\n'));
ws.close(); chrome.kill();
process.exit(0);

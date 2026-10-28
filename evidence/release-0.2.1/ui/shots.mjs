// 用无头 Chrome（CDP）在 gallery 预览里点按钮并截图。用法：node shots.mjs <输出目录>
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const out = process.argv[2], base = 'http://127.0.0.1:5299/gallery.html';
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--remote-debugging-port=9333',
  `--user-data-dir=${mkdtempSync(join(tmpdir(), 'cdp-'))}`, '--window-size=1280,900', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
const wait = ms => new Promise(r => setTimeout(r, ms));
let target;
for (let i = 0; i < 50 && !target; i++) {
  await wait(200);
  try { target = (await (await fetch('http://127.0.0.1:9333/json')).json()).find(t => t.type === 'page'); } catch { /* not up yet */ }
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r));
let id = 0; const pending = new Map();
ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJs = async expr => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;
const go = async url => { await send('Page.navigate', { url }); await wait(7000); };
const shot = async (name, selector) => {
  let clip;
  if (selector) {
    const r = await evalJs(`(() => { const b = document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect(); return b && { x: b.x, y: b.y, width: b.width, height: b.height }; })()`);
    if (r) clip = { ...r, scale: 1 };
  }
  const { result } = await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip } : {}) });
  writeFileSync(join(out, name), Buffer.from(result.data, 'base64'));
};
const state = () => evalJs(`[...document.querySelectorAll('.tbar-new')].map(b => (b.getAttribute('aria-label')) + (b.disabled ? '(disabled)' : '')).join(',') + ' | ' + [...document.querySelectorAll('button')].map(b => b.textContent.trim()).filter(t => /开始|暂停|继续|放弃/.test(t)).join(',')`);
const click = sel => evalJs(`document.querySelector(${JSON.stringify(sel)})?.click(), true`);
// 在输入框写一件事并回车开始计
const startTyping = async () => {
  await evalJs(`(() => { const i = document.querySelector('#what'); i.focus(); return true; })()`); await wait(400);
  await send('Input.insertText', { text: '写周报' }); await wait(200);
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await evalJs(`document.activeElement.blur(), true`); await wait(800);
};
const log = [];
await send('Page.enable'); await send('Runtime.enable');

// 小窗：计时中没有说明那一条
await send('Emulation.setDeviceMetricsOverride', { width: 600, height: 200, deviceScaleFactor: 1, mobile: false });
await go(`${base}?page=mini`);
log.push(`mini: .mini-cap count = ${await evalJs(`document.querySelectorAll('.mini-cap').length`)}`);
await shot('mini-running.png');

await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
for (const layout of ['fused', 'split']) {
  await go(`${base}?page=live${layout === 'fused' ? '&layout=fused' : ''}`);
  log.push(`${layout} idle: ${await state()}`); await shot(`${layout}-1-idle.png`);
  await startTyping();
  log.push(`${layout} running: ${await state()}`); await shot(`${layout}-2-running.png`);
  await click('button[aria-label="停止"]'); await wait(800);
  log.push(`${layout} after stop: ${await state()}`); await shot(`${layout}-3-stopped.png`);
  await startTyping();
  await evalJs(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('暂停'))?.click(), true`); await wait(800);
  log.push(`${layout} after pause: ${await state()}`); await shot(`${layout}-4-paused.png`);
}
writeFileSync(join(out, 'shots.log'), log.join('\n') + '\n');
console.log(log.join('\n'));
ws.close(); chrome.kill();
process.exit(0);

// README 素材：无头 Chrome（CDP）打开 gallery 预览，截静态图，并把一段操作录成帧（之后用 ffmpeg 合成 GIF）。
// 用法：先 npx vite --host 127.0.0.1 --port 5299 --strictPort，再 node docs/assets/readme-shots.mjs <输出目录>；GIF 用 ffmpeg 把 <输出目录>/frames 合成
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const out = process.argv[2], base = 'http://127.0.0.1:5299/gallery.html';
mkdirSync(join(out, 'frames'), { recursive: true });
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--remote-debugging-port=9335',
  `--user-data-dir=${mkdtempSync(join(tmpdir(), 'cdp-'))}`, '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
const wait = ms => new Promise(r => setTimeout(r, ms));
let target;
for (let i = 0; i < 50 && !target; i++) {
  await wait(200);
  try { target = (await (await fetch('http://127.0.0.1:9335/json')).json()).find(t => t.type === 'page'); } catch { /* not up yet */ }
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r));
let id = 0; const pending = new Map();
ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJs = async expr => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;
const size = (width, height) => send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
// 预览页底下的调试信息（条目表、mode=…）不进截图
const hideDebug = () => evalJs(`(() => { const s = document.createElement('style'); s.textContent = '#state { display: none !important; }'; document.head.append(s); return true; })()`);
const go = async (query, ms = 6000) => { await send('Page.navigate', { url: `${base}?${query}` }); await wait(ms); await hideDebug(); await wait(300); };
const shot = async (name, format = 'png') => {
  const { result } = await send('Page.captureScreenshot', { format, ...(format === 'jpeg' ? { quality: 92 } : {}) });
  writeFileSync(join(out, name), Buffer.from(result.data, 'base64'));
};
const clickText = text => evalJs(`(() => { const b = [...document.querySelectorAll('button')].find(b => b.textContent.includes(${JSON.stringify(text)}) && !b.disabled); b?.click(); return !!b; })()`);
const typeTask = async text => {
  await evalJs(`document.querySelector('#what').focus(), true`); await wait(500);
  for (const ch of text) { await send('Input.insertText', { text: ch }); await wait(140); }
  await wait(400);
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await evalJs(`document.activeElement.blur(), true`);
};
await send('Page.enable'); await send('Runtime.enable');

// 静态图
await size(1280, 800);
await go('page=live&layout=fused'); await typeTask('写周报'); await wait(2500); await shot('home-fused.png');
await go('page=live'); await clickText('抽卡'); await wait(2000); await clickText('开始START'); await wait(3000);
console.log('home-card:', await evalJs(`[...document.querySelectorAll('.abtn')].map(b => b.textContent.trim()).join(' | ')`));
await shot('home-card.png');
await go('page=calendar'); await shot('calendar.png');
await go('page=pool'); await shot('task-pool.png');
await size(640, 220);
await go('page=mini');
const r = await evalJs(`(() => { const b = document.querySelector('.miniwin').getBoundingClientRect(); return { x: b.x - 12, y: b.y - 12, width: b.width + 24, height: b.height + 24 }; })()`);
writeFileSync(join(out, 'mini.png'), Buffer.from((await send('Page.captureScreenshot', { format: 'png', clip: { ...r, scale: 2 } })).result.data, 'base64'));

// GIF：融合布局，写下一件事开始计时 → 停止 → 抽一张卡并开始
await size(1100, 700);
await go('page=live&layout=fused');
let n = 0, recording = true;
const recorder = (async () => {
  while (recording) {
    const { result } = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(out, 'frames', `f${String(n++).padStart(4, '0')}.png`), Buffer.from(result.data, 'base64'));
    await wait(80);
  }
})();
const t0 = Date.now();
await wait(1200);
await typeTask('写周报'); await wait(3000);
await evalJs(`document.querySelector('button[aria-label="停止"]')?.click(), true`); await wait(1800);
await clickText('抽一张卡'); await wait(1800);
await clickText('开始START'); await wait(3000);
recording = false; await recorder;
const fps = n / ((Date.now() - t0) / 1000);
writeFileSync(join(out, 'frames', 'fps.txt'), fps.toFixed(2));
console.log(`frames ${n}, fps ${fps.toFixed(2)}`);
ws.close(); chrome.kill();
process.exit(0);

// README 素材（0.3.1）：无头 Chrome（CDP）打开 gallery 的接线预览（内存数据 + 真 service），截静态图，并把两段操作录成帧，之后用 ffmpeg 合成 GIF。
// 用法：
//   npx vite --host 127.0.0.1 --port 5299 --strictPort
//   node docs/assets/readme-shots.mjs <输出目录>
//   GIF：<输出目录>/frames-<名字>/ 里是帧，fps.txt 是实际帧率，见文件末尾的 ffmpeg 命令。
// 不开真程序窗口；数据都在预览页的内存文件系统里，刷新就清空。
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const out = process.argv[2], base = 'http://127.0.0.1:5299/gallery.html';
if (!out) { console.error('用法：node docs/assets/readme-shots.mjs <输出目录>'); process.exit(2); }
mkdirSync(out, { recursive: true });
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
const evalJs = async expr => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? 'evaluate failed');
  return r.result?.result?.value;
};
const size = (width, height) => send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
// 预览页底下的调试信息（条目表、mode=…）不进截图
const hideDebug = () => evalJs(`(() => { const s = document.createElement('style'); s.textContent = '#state { display: none !important; }'; document.head.append(s); return true; })()`);
const go = async (query, ms = 8000) => { await send('Page.navigate', { url: `${base}?${query}` }); await wait(ms); await hideDebug(); await wait(300); };
const shot = async (name, clip) => {
  const { result } = await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip } : {}) });
  writeFileSync(join(out, name), Buffer.from(result.data, 'base64'));
};
// 按钮文字去掉空白后包含 text；sel 限定范围
const clickText = async (text, sel = 'button') => {
  const ok = await evalJs(`(() => { const b = [...document.querySelectorAll(${JSON.stringify(sel)})].find(b => b.getClientRects().length && b.textContent.replace(/\\s+/g, '').includes(${JSON.stringify(text.replace(/\s+/g, ''))}) && !b.disabled); b?.click(); return !!b; })()`);
  if (!ok) {
    await shot('failed-step.png');
    throw new Error(`找不到按钮「${text}」（${sel}）：${await evalJs('document.body.innerText')}`);
  }
};
const click = async sel => { if (!await evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); e?.click(); return !!e; })()`)) throw new Error(`找不到 ${sel}`); };
const inCard = async (name, btn) => {
  const ok = await evalJs(`(() => { const card = [...document.querySelectorAll('.bq')].find(c => c.textContent.includes(${JSON.stringify(name)}));
    const b = card && [...card.querySelectorAll('button')].find(x => x.textContent.includes(${JSON.stringify(btn)})); b?.click(); return !!b; })()`);
  if (!ok) throw new Error(`卡「${name}」上没有〔${btn}〕`);
};
const focus = sel => evalJs(`document.querySelector(${JSON.stringify(sel)}).focus(), true`);
const type = async (text, gap = 110) => { for (const ch of text) { await send('Input.insertText', { text: ch }); await wait(gap); } };
const centerOf = sel => evalJs(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
const mouse = (x, y) => send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' });
// 鼠标滑到某个元素上（分几步移过去，悬停的过渡才会演出来）
const glide = async (sel, steps = 8) => {
  const to = await centerOf(sel);
  for (let i = 1; i <= steps; i++) { await mouse(to.x * i / steps + 640 * (1 - i / steps), to.y * i / steps + 400 * (1 - i / steps)); await wait(40); }
};
await send('Page.enable'); await send('Runtime.enable');

/** 在背包里新建一个支线任务（第一项时间盒、第二项结果卡），排进今天；再把预置的主线下一项也排进今天，标「高」。 */
async function planToday() {
  await clickText('今日任务板'); await wait(900);
  await clickText('新建支线任务'); await wait(700);
  await focus('#proj-name'); await type('读《数据库系统》', 60);
  await click('.ie-foot button'); await wait(250); await click('.ie-foot button'); await wait(250);
  await focus('#task-items-0'); await type('第 3 章', 60);
  await focus('#task-items-1'); await type('写读书笔记', 60);
  await evalJs(`(() => { const row = document.querySelectorAll('.ie-row')[0]; [...row.querySelectorAll('button')].find(x => x.textContent.includes('时间盒')).click(); return true; })()`);
  await wait(300);
  return {
    async save() { await clickText('放入'); await wait(1200); },
    async plan() {
      await inCard('数据库', '排进今天'); await wait(600); await clickText('排进今天', '.bp-pop button'); await wait(900);
      await inCard('后端实习', '排进今天'); await wait(600); await clickText('高', '.bp-pop button'); await clickText('排进今天', '.bp-pop button'); await wait(900);
    },
  };
}

// ---------- 静态图 ----------
await size(1280, 800);

// 1. 背包抽屉：今日任务板 + 便签任务卡；新建任务对话框（每项带类型）；排进今天浮层
await go('page=live&layout=fused&bag');
let p = await planToday();
await shot('new-task.png');
await p.save();
await inCard('数据库', '详情'); await wait(700);
await clickText('背包·任务'); await wait(600);
await inCard('后端实习', '排进今天'); await wait(700);
await shot('plan-popover.png');
await clickText('高', '.bp-pop button'); await clickText('排进今天', '.bp-pop button'); await wait(900);
await inCard('数据库', '排进今天'); await wait(600); await clickText('排进今天', '.bp-pop button'); await wait(1200);
await shot('drawer.png');

// 2. 翻卡（洗牌后翻开的那一刻）
await clickText('抽一张'); await wait(4300);
await shot('flip.png');
await clickText('开始', '.fd-deal button'); await wait(2500);

// 3. 首页做卡：〔休息一下〕、大读数是今天的
await shot('home-card.png');

// 4. 插入卡：平时、鼠标在〔结束原任务〕上
await evalJs(`document.querySelector('#dev-away-wc').click(), true`); await wait(2600);
await shot('insert.png');
await glide('.ins-up-end'); await wait(900);
await shot('insert-end.png');
await mouse(5, 5); await wait(500);
await clickText('回到任务', '.ins-up-back'); await wait(2000);

// 5. 缩小 = 拆成两项：拆时间盒卡「第 3 章」，对话框里有分钟条子和滑块
await evalJs(`document.querySelector('#dev-open-bag').click(), true`); await wait(900);   // 做卡时首页没有〔今日任务板〕，用预览页的「背包」开关
await inCard('数据库', '开始'); await wait(2500);
await clickText('缩小'); await wait(1500);
await focus('#split-today'); await type('只读 3.1–3.3', 40);
await shot('shrink.png');

// 6. 日历（接线预览里的真 CalendarScreen；旧的 page=calendar 是 0.3.0 的静态外壳，顶栏还有「背包」）
await go('page=live&view=calendar'); await shot('calendar.png');

// 7. 小窗：插入状态
await size(640, 220);
await go('page=mini&ins');
const r = await evalJs(`(() => { const b = document.querySelector('.miniwin').getBoundingClientRect(); return { x: b.x - 12, y: b.y - 12, width: b.width + 24, height: b.height + 24 }; })()`);
await shot('mini.png', { ...r, scale: 2 });

// ---------- GIF ----------
/** 录 run() 期间的帧到 frames-<name>/，返回实际帧率 */
async function record(name, run) {
  const dir = join(out, `frames-${name}`); mkdirSync(dir, { recursive: true });
  let n = 0, recording = true;
  const recorder = (async () => {
    while (recording) {
      const { result } = await send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(join(dir, `f${String(n++).padStart(4, '0')}.png`), Buffer.from(result.data, 'base64'));
      await wait(60);
    }
  })();
  const t0 = Date.now();
  await run();
  recording = false; await recorder;
  const fps = n / ((Date.now() - t0) / 1000);
  writeFileSync(join(dir, 'fps.txt'), fps.toFixed(2));
  console.log(`${name}: frames ${n}, fps ${fps.toFixed(2)}`);
}
await size(1100, 700);

// GIF 1：拉开背包 → 排进今天 → 抽一张（翻卡）→ 开始
await go('page=live&layout=fused&bag');
await clickText('今日任务板'); await wait(900);
await inCard('后端实习', '排进今天'); await wait(500); await clickText('高', '.bp-pop button'); await clickText('排进今天', '.bp-pop button'); await wait(500);
await clickText('ESC收起'); await wait(900);
await record('draw', async () => {
  await wait(900);
  await clickText('今日任务板'); await wait(1200);
  await clickText('新建支线任务'); await wait(700);
  await focus('#proj-name'); await type('读《数据库系统》', 90);
  await click('.ie-foot button'); await wait(300);
  await focus('#task-items-0'); await type('第 3 章', 90);
  await evalJs(`(() => { const row = document.querySelectorAll('.ie-row')[0]; [...row.querySelectorAll('button')].find(x => x.textContent.includes('时间盒')).click(); return true; })()`);
  await wait(700);
  await clickText('放入'); await wait(1000);
  await inCard('数据库', '排进今天'); await wait(900); await clickText('排进今天', '.bp-pop button'); await wait(1200);
  await clickText('抽一张'); await wait(4600);
  await clickText('开始', '.fd-deal button'); await wait(2600);
});

// GIF 2：做卡中插进一件事 → 插入卡盖上来 → 鼠标掠过回去区域 → 回到任务，卡接着计
await go('page=live&layout=fused&bag');
await evalJs(`document.querySelector('#dev-start-card').click(), true`); await wait(5000);
await record('insert', async () => {
  await wait(900);
  await evalJs(`document.querySelector('#dev-away-wc').click(), true`); await wait(2600);
  await clickText('暂停', '.ins-top button'); await wait(1400);
  await clickText('继续', '.ins-top button'); await wait(1400);
  await glide('.ins-up-end'); await wait(1300);
  await glide('.ins-up-back'); await wait(1500);
  await clickText('回到任务', '.ins-up-back'); await wait(2800);
});

ws.close(); chrome.kill();
process.exit(0);

// 合成 GIF（两遍：先生成调色板，再用它编码；宽度缩到 900，帧率按 fps.txt）：
//   ffmpeg -y -framerate <fps> -i <out>/frames-draw/f%04d.png -vf "fps=12,scale=900:-1:flags=lanczos,palettegen=stats_mode=diff" <out>/pal.png
//   ffmpeg -y -framerate <fps> -i <out>/frames-draw/f%04d.png -i <out>/pal.png -lavfi "fps=12,scale=900:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5" docs/assets/demo-draw.gif

// 探针：隔离真窗口里插入一次，逐帧看插入卡和底下那张有没有动画在跑
import { connect, kill, launch, loadEnv, sleep } from './lib.mjs';
const env = await loadEnv(), PORT = 19397;
kill(env.exe); await sleep(1000); launch(env.exe, PORT);
const page = await connect(PORT, 'main');
await page.waitFor(`document.body.innerText.includes('首页') && !document.body.innerText.includes('正在打开数据目录')`, 30_000, 'home');
await sleep(1200);
const state = await page.eval(`({ insert: !!document.querySelector('.ins-top'), motion: document.documentElement.dataset.motion, reduce: matchMedia('(prefers-reduced-motion: reduce)').matches,
  card: document.querySelector('.card .title, .card h1')?.textContent ?? null })`);
console.log('before:', JSON.stringify(state));
// 回到任务（如果正在插入）、确保在做卡
if (state.insert) { await page.eval(`document.querySelector('.ins-up-back')?.click()`); await sleep(1500); }
// 插入快捷活动：打开弹层点「上厕所」，然后每 40ms 采样一次动画
await page.eval(`[...document.querySelectorAll('.dock-toggle')].find(b => b.textContent.includes('快捷活动'))?.click()`); await sleep(400);
await page.eval(`window.__frames = []; (() => { const t0 = performance.now(); const tick = () => {
  const top = document.querySelector('.ins-top'), under = document.querySelector('.ins-stack > .card:not(.ins-top)');
  window.__frames.push({ t: Math.round(performance.now() - t0), top: !!top, topAnims: top?.getAnimations().length ?? -1, topTf: top ? getComputedStyle(top).transform : null,
    underAnims: under?.getAnimations().length ?? -1, underTf: under ? getComputedStyle(under).transform : null });
  if (performance.now() - t0 < 1200) requestAnimationFrame(tick); }; requestAnimationFrame(tick); })()`);
await page.eval(`[...document.querySelectorAll('.tray button')].find(b => b.textContent.includes('上厕所'))?.click()`);
await sleep(1600);
const frames = await page.eval(`window.__frames`);
const shown = frames.filter(f => f.top);
console.log('frames:', frames.length, 'with insert card:', shown.length);
console.log(JSON.stringify(shown.slice(0, 6)));
console.log(JSON.stringify(shown.filter(f => f.topAnims > 0 || f.underAnims > 0).slice(0, 4)));
page.close();
process.exit(0);

// 探针：点〔回到任务〕后每帧看底下那张卡恢复了没有（亮度 / 灰度）、插入卡还在不在，找「停住」的那一段
import { connect, sleep } from './lib.mjs';
const page = await connect(Number(process.argv[2] ?? 19397), 'main');
if (!await page.eval(`!!document.querySelector('.ins-top')`)) {
  await page.eval(`[...document.querySelectorAll('.dock-toggle')].find(b => b.textContent.includes('快捷活动'))?.click()`); await sleep(300);
  await page.eval(`[...document.querySelectorAll('.tray button')].find(b => b.textContent.includes('上厕所'))?.click()`);
  await page.waitFor(`!!document.querySelector('.ins-top')`, 10_000, 'insert'); await sleep(1500);
}
await page.eval(`window.__f = []; (() => { const t0 = performance.now(); const tick = () => {
  const top = document.querySelector('.ins-top'), card = document.querySelector('.home-stage .card:not(.ins-top)'), inner = card?.querySelector(':scope > .card-in');
  const cs = inner ? getComputedStyle(inner) : null;
  window.__f.push({ t: Math.round(performance.now() - t0), top: !!top, topOp: top ? +getComputedStyle(top).opacity : null, cardOp: cs ? +cs.opacity : null, gray: cs?.filter ?? null });
  if (performance.now() - t0 < 1200) requestAnimationFrame(tick); }; requestAnimationFrame(tick); document.querySelector('.ins-up-back').click(); })()`);
await sleep(1500);
const f = await page.eval(`window.__f`);
const pick = ms => f.reduce((a, b) => Math.abs(b.t - ms) < Math.abs(a.t - ms) ? b : a);
console.log(JSON.stringify([0, 100, 200, 300, 400, 500, 600, 800].map(pick)));
page.close(); process.exit(0);

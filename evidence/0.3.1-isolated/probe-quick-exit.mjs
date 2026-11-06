// 探针：隔离真窗口里插入「上厕所」，再在快捷活动弹层里点一次「上厕所」（= 回到任务），看插入卡消失前有没有收走动画
import { connect, launch, loadEnv, sleep } from './lib.mjs';
const env = await loadEnv(), PORT = 19397;
launch(env.exe, PORT);
const page = await connect(PORT, 'main');
await page.waitFor(`document.body.innerText.includes('首页') && !document.body.innerText.includes('正在打开数据目录')`, 30_000, 'home'); await sleep(1200);
const openTray = () => page.eval(`[...document.querySelectorAll('.dock-toggle')].find(b => b.textContent.includes('快捷活动'))?.click()`);
const clickWc = () => page.eval(`[...document.querySelectorAll('.tray button')].find(b => b.textContent.includes('上厕所'))?.click()`);
if (!await page.eval(`!!document.querySelector('.ins-top')`)) { await openTray(); await sleep(300); await clickWc(); await page.waitFor(`!!document.querySelector('.ins-top')`, 10_000, 'insert'); await sleep(1500); }
await openTray(); await sleep(400);
await page.eval(`window.__f = []; (() => { const t0 = performance.now(); const tick = () => { const top = document.querySelector('.ins-top');
  window.__f.push({ t: Math.round(performance.now() - t0), top: !!top, a: top?.getAnimations().length ?? 0, op: top ? +getComputedStyle(top).opacity : null });
  if (performance.now() - t0 < 2000) requestAnimationFrame(tick); }; requestAnimationFrame(tick); })()`);
await clickWc(); await sleep(2200);
const f = await page.eval(`window.__f`), withCard = f.filter(x => x.top);
console.log(JSON.stringify({ framesWithCard: withCard.length, animating: withCard.filter(x => x.a > 0).length, lastOpacity: withCard.at(-1)?.op, goneAtMs: f.find(x => !x.top)?.t ?? null }));
page.close(); process.exit(0);

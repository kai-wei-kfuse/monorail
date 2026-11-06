// 探针：隔离真窗口里量「点〔回到任务〕→ 插入卡消失（提交完成、重新渲染）」要多久
import { connect, loadEnv, sleep } from './lib.mjs';
const env = await loadEnv(), PORT = Number(process.argv[2] ?? 19397);
const page = await connect(PORT, 'main');
const results = [];
for (let i = 0; i < 3; i++) {
  if (!await page.eval(`!!document.querySelector('.ins-top')`)) {
    await page.eval(`[...document.querySelectorAll('.dock-toggle')].find(b => b.textContent.includes('快捷活动'))?.click()`); await sleep(300);
    const t0 = Date.now();
    await page.eval(`[...document.querySelectorAll('.tray button')].find(b => b.textContent.includes('上厕所'))?.click()`);
    await page.waitFor(`!!document.querySelector('.ins-top')`, 10_000, 'insert shown');
    results.push({ insertMs: Date.now() - t0 });
    await sleep(1200);
  }
  const t1 = await page.eval(`(() => { window.__t = performance.now(); document.querySelector('.ins-up-back').click(); return 0; })()`);
  await page.waitFor(`!document.querySelector('.ins-top')`, 10_000, 'insert gone');
  const gone = await page.eval(`Math.round(performance.now() - window.__t)`);
  results.at(-1).backMs = gone;
  await sleep(800);
}
console.log(JSON.stringify(results));
page.close();
process.exit(0);

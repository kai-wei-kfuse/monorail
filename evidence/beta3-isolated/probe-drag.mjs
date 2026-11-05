// 日历 1 分钟拖动（D2）的分步实测：日视图 1×，在 06:00 处按下、往下拖约 1.2 分钟的像素、松手，记下影子和建出来的条目。
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { connect, here, loadEnv, sleep } from './lib.mjs';
const env = await loadEnv(), page = await connect(19371, 'main');
const hist = async () => { const dir = join(env.data, 'history'), out = []; for (const d of await readdir(dir)) for (const f of await readdir(join(dir, d))) out.push(JSON.parse(await readFile(join(dir, d, f), 'utf8'))); return out.sort((a, b) => a.at.localeCompare(b.at)); };
const n0 = (await hist()).length;
const scale = (process.argv[2] ?? '1x').replace('x', '×'), hour = process.argv[3] ?? '06:00';
await page.click('button.tab-btn', '日历');
await sleep(600);
console.log('segs', await page.eval(`[...document.querySelectorAll('.seg button')].map(b => b.textContent).join('|')`));
await page.click('.seg button', '日');
await page.click('.seg button', scale);
await sleep(400);
const geo = await page.eval(`(() => { const col = document.querySelector('.cal-col'), r = col.getBoundingClientRect();
  const label = [...document.querySelectorAll('.cal-hours span')].find(s => s.textContent === ${JSON.stringify(hour)}), hourPx = parseFloat(getComputedStyle(document.querySelector('.cal-grid')).getPropertyValue('--hour-px'));
  label.scrollIntoView({ block: 'center' }); const y = label.getBoundingClientRect().y; return { x: r.x + r.width / 2, y, hourPx, view: document.querySelectorAll('.cal-col').length }; })()`);
await sleep(300);
// 按列顶（日界 04:00）+ 小时数 × hourPx 算出那条整点线，往下 1px 按下
const [hh, mm] = hour.split(':').map(Number), offsetHours = ((hh - 4 + 24) % 24) + mm / 60;
const g = await page.eval(`document.querySelector('.cal-col').getBoundingClientRect().y + ${offsetHours} * ${geo.hourPx}`);
const y0 = g + 1, dy = geo.hourPx / 60 * 1.2;
const log = [];
await page.mouse('mousePressed', geo.x, y0);
await page.mouse('mouseMoved', geo.x, y0 + dy / 2);
await page.mouse('mouseMoved', geo.x, y0 + dy);
log.push({ ghost: await page.eval(`document.querySelector('.blk.ghost')?.innerText ?? null`) });
await page.mouse('mouseReleased', geo.x, y0 + dy);
await sleep(1500);
const added = (await hist()).slice(n0);
log.push({ pop: await page.eval(`document.querySelector('.cal-pop .cal-pop-time')?.innerText?.replace(/\\s+/g, ' ') ?? null`) });
await page.shot(join(here, 'shots', `06-d2-drag-${scale.replace('×', 'x')}.png`));
console.log(JSON.stringify({ scale, geo, y0, dy, log, added: added.map(r => [r.action, r.changes.find(c => c.field === '时间')?.after]) }));
await page.key('Escape');
await sleep(300);
// 点短块（真实像素命中）：在刚建的 1 分钟块中心按下松开，应打开弹窗而不是新建
if (process.argv.includes('--click')) {
  const n1 = (await hist()).length;
  const b = await page.eval(`(() => { const t = ${JSON.stringify(added[0]?.changes?.find(c => c.field === '时间')?.after?.slice(6, 11) ?? '')};
    const blk = [...document.querySelectorAll('.blk:not(.idle):not(.ghost)')].filter(e => (e.title || e.innerText || '').length >= 0).map(e => ({ e, r: e.getBoundingClientRect() }))
      .find(x => Math.abs(x.r.y - ${y0}) < 3 && x.r.height < 10); if (!blk) return null; return { x: blk.r.x + blk.r.width / 2, y: blk.r.y + blk.r.height / 2, h: blk.r.height }; })()`);
  if (b) {
    await page.mouse('mousePressed', b.x, b.y); await page.mouse('mouseReleased', b.x, b.y); await sleep(700);
    const opened = await page.eval(`!!document.querySelector('.cal-pop')`), more = (await hist()).slice(n1).map(r => r.action);
    await page.shot(join(here, 'shots', `06-d2-click-short-${scale.replace('×', 'x')}.png`));
    console.log(JSON.stringify({ clickShort: { block: b, opened, newHistory: more } }));
    await page.key('Escape');
  } else console.log(JSON.stringify({ clickShort: 'block not found' }));
}
page.close(); process.exit(0);

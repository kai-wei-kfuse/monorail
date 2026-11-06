// 探针：在隔离真窗口里读 store 和抽屉的 DOM，查任务模式关掉后抽屉为什么还显示板子
import { connect, kill, launch, loadEnv, sleep } from './lib.mjs';
const env = await loadEnv(), PORT = 19395;
kill(env.exe); await sleep(800); launch(env.exe, PORT);
const page = await connect(PORT, 'main');
await page.waitFor(`document.body.innerText.includes('首页') && !document.body.innerText.includes('正在打开数据目录')`, 30_000, 'home');
await sleep(1000);
await page.eval(`document.querySelector('.dock-toggle.bp-bag')?.click()`); await sleep(800);
const out = await page.eval(`(() => ({
  board: !!document.querySelector('.bp-drawer .bp-board'),
  quest: !!document.querySelector('.bp-drawer .bq'),
  ideasOnly: document.querySelector('.bp-body')?.hasAttribute('data-ideas-only') ?? null,
  todayBoardBtn: [...document.querySelectorAll('.abtn')].some(b => b.textContent.includes('今日任务板')),
  note: document.querySelector('.bp-mhead .note')?.textContent ?? null,
}))()`);
console.log(JSON.stringify(out));
page.close(); kill(env.exe);
process.exit(0);

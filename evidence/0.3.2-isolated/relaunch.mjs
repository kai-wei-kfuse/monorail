// 启动并聚焦 0.3.2 隔离桌面窗口（主窗口 + 小窗口），零触碰日常安装版与日常数据。
import { DAILY, connect, count, kill, launch, loadEnv, sleep } from './lib.mjs';

const env = await loadEnv();
if (env.exe === DAILY.exe) throw new Error('Refusing to touch daily executable');
kill(env.exe);
await sleep(600);
launch(env.exe, 19432);
const main = await connect(19432, 'main');
await main.waitFor("document.body.innerText.includes('首页') && !document.body.innerText.includes('正在打开数据目录')", 20_000, 'home ready');
await main.invoke('show_main');
await sleep(300);
const miniBtnText = await main.eval(`document.querySelector('.dock-toggle[title="开关小窗口（M）"]')?.textContent ?? ''`);
if (miniBtnText.includes('开启小窗口')) {
  await main.click('.dock-toggle[title="开关小窗口（M）"]');
  await sleep(400);
}
main.close();
console.log(JSON.stringify({
  launched: env.exe,
  dataDir: env.data,
  isolatedProcesses: count(env.exe),
  dailyProcesses: count(DAILY.exe),
}, null, 2));

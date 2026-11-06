// 只重新打开隔离窗口（不重建、不换身份、不动隔离数据）。用法（在 app/ 下）：node evidence/0.3.1-isolated/relaunch.mjs
import { DAILY, count, launch, loadEnv, sleep } from './lib.mjs';

const env = await loadEnv();
if (env.exe === DAILY.exe) throw new Error('目标是日常安装版，停下');
if (count(env.exe) === 0) launch(env.exe, 19397);
await sleep(3000);
console.log('LAUNCHED', env.exe, '进程数', count(env.exe), '日常 exe 进程数', count(DAILY.exe));

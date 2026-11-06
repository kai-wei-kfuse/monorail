// 同一个隔离身份重建 exe（不换身份、不动隔离数据）：先 npm run build，再跑这个；--launch 关掉旧的隔离窗口并重新打开
// 用法（在 app/ 下）：node evidence/0.3.1-isolated/rebuild.mjs [--launch]
import { execFileSync } from 'node:child_process';
import { copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DAILY, count, kill, launch, loadEnv, sleep } from './lib.mjs';

const env = await loadEnv();
if (env.exe === DAILY.exe) throw new Error('目标是日常安装版，停下');
execFileSync(process.execPath, ['node_modules/@tauri-apps/cli/tauri.js', 'build', '--debug', '--no-bundle', '--config', env.config], { stdio: 'inherit' });
kill(env.exe);
await sleep(800);
await copyFile(resolve('src-tauri/target/debug/pixel-record.exe'), env.exe);
await copyFile(resolve('dist-mcp/monorail-mcp.mjs'), env.mcp);
await copyFile(resolve('dist-cli/monorail-cli.mjs'), env.cli);
console.log('REBUILT', env.exe);
if (process.argv.includes('--launch')) {
  launch(env.exe, 19397);
  await sleep(3000);
  console.log('LAUNCHED', env.exe, '进程数', count(env.exe), '日常 exe 进程数', count(DAILY.exe));
}

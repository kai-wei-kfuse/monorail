import { spawn } from 'node:child_process';
// Project policy: the entire test process, not each individual test, has 60 seconds.
const child = spawn(process.execPath, ['node_modules/vitest/vitest.mjs', 'run'], { stdio: 'inherit' });
const deadline = setTimeout(() => {
  console.error('TEST_PROCESS_TIMEOUT: exceeded 60 seconds');
  if (process.platform === 'win32') spawn('taskkill', ['/PID', String(child.pid), '/T', '/F']);
  else child.kill('SIGKILL');
  process.exitCode = 1;
}, 60_000);
child.on('exit', (code, signal) => { clearTimeout(deadline); process.exitCode = process.exitCode || (signal ? 1 : code ?? 1); });
child.on('error', error => { clearTimeout(deadline); console.error(error); process.exitCode = 1; });

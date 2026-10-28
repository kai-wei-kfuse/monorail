import { spawn } from 'node:child_process';
// The repository requires a hard 60-second deadline for backend unit tests. Compile separately first.
const child = spawn('cargo', ['+1.95.0', 'test'], { cwd: new URL('../src-tauri/', import.meta.url), stdio: 'inherit' });
const deadline = setTimeout(() => {
  console.error('RUST_TEST_PROCESS_TIMEOUT: exceeded 60 seconds');
  if (process.platform === 'win32') spawn('taskkill', ['/PID', String(child.pid), '/T', '/F']);
  else child.kill('SIGKILL');
  process.exitCode = 1;
}, 60_000);
child.on('exit', (code, signal) => { clearTimeout(deadline); process.exitCode = process.exitCode || (signal ? 1 : code ?? 1); });
child.on('error', error => { clearTimeout(deadline); console.error(error); process.exitCode = 1; });

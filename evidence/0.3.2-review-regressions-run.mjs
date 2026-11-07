import { spawn } from 'node:child_process';
// Repository policy requires a 60-second deadline for the complete backend test process.
const child = spawn(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', '--config', 'evidence/0.3.2-review-regressions.config.ts'], { stdio: 'inherit' });
const deadline = setTimeout(() => { console.error('TEST_PROCESS_TIMEOUT: exceeded 60 seconds'); spawn('taskkill', ['/PID', String(child.pid), '/T', '/F']); process.exitCode = 1; }, 60000);
child.on('exit', (code, signal) => { clearTimeout(deadline); process.exitCode = process.exitCode || (signal ? 1 : code ?? 1); });
child.on('error', error => { clearTimeout(deadline); console.error(error); process.exitCode = 1; });

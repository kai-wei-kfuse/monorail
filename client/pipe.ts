import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createConnection } from 'node:net';
import { isAbsolute, join } from 'node:path';
import { createInterface } from 'node:readline';
import type { ApplicationRequest } from '../src/shared/application.ts';
import { ApplicationError, applicationErrorSchema } from '../src/shared/appError.ts';
import { launchWindowsBackground } from './windowsLauncher.ts';

export const DEFAULT_PIPE = String.raw`\\.\pipe\local.pixelrecord.app.mcp`;

export interface DesktopCallOptions {
  signal?: AbortSignal;
  configDir?: string;
  executable?: string;
  autoStart?: boolean;
  spawnProcess?: (executable: string, args: string[]) => ChildProcess;
}

interface ActiveSpawn {
  process: ChildProcess;
  release(): void;
  diagnostics(): string;
  waiters: number;
  failedError?: Error;
  exited: boolean;
  exitCode: number | null;
  exitSignal: NodeJS.Signals | null;
}

const activeSpawns = new Map<string, ActiveSpawn>();

export function defaultPipePath(): string {
  return process.env.MONORAIL_PIPE ?? process.env.MONORAIL_MCP_PIPE ?? DEFAULT_PIPE;
}

function pipeIdentifier(pipe: string): string | null {
  const match = /^\\\\\.\\pipe\\(.+)\.mcp$/i.exec(pipe);
  return match ? match[1] : null;
}

function resolveConfigDir(pipe: string, options: DesktopCallOptions): string | null {
  const explicit = options.configDir ?? process.env.MONORAIL_CONFIG_DIR ?? process.env.MONORAIL_MCP_CONFIG_DIR;
  if (explicit) return explicit;
  const appData = process.env.APPDATA;
  const id = pipeIdentifier(pipe);
  if (!appData || !id) return null;
  const candidate = join(appData, id);
  if (pipe === DEFAULT_PIPE || existsSync(candidate)) return candidate;
  return null;
}

function validateLaunchTarget(configDir: string, options: DesktopCallOptions): string {
  const configPath = join(configDir, 'config.json');
  if (!existsSync(configPath)) {
    throw new Error('SETUP_REQUIRED：无法连接单轨本机入口，单轨尚未完成首次数据目录初始化，请先打开单轨完成设置');
  }
  let root: unknown;
  try {
    const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as { root?: unknown };
    root = parsed.root;
  } catch (error) {
    throw new Error(`CONFIG_CORRUPTED：无法连接单轨本机入口，单轨配置文件损坏：${error instanceof Error ? error.message : String(error)}`);
  }
  if (typeof root !== 'string' || !isAbsolute(root) || !existsSync(root) || !statSync(root).isDirectory()) {
    throw new Error('CONFIG_CORRUPTED：无法连接单轨本机入口，单轨数据目录配置无效或目录不存在');
  }
  const explicitExe = options.executable ?? process.env.MONORAIL_EXECUTABLE ?? process.env.MONORAIL_MCP_EXECUTABLE;
  if (explicitExe) {
    if (!isAbsolute(explicitExe) || !existsSync(explicitExe)) {
      throw new Error('CONFIG_CORRUPTED：无法连接单轨本机入口，指定的单轨可执行文件路径无效或不存在');
    }
    return explicitExe;
  }
  const hostPath = join(configDir, 'mcp-host.json');
  if (!existsSync(hostPath)) {
    throw new Error('UNAVAILABLE：无法连接单轨本机入口，请确认新版单轨已安装并完成首次运行');
  }
  let executable: unknown;
  try {
    const parsed = JSON.parse(readFileSync(hostPath, 'utf8')) as { executable?: unknown };
    executable = parsed.executable;
  } catch (error) {
    throw new Error(`CONFIG_CORRUPTED：无法连接单轨本机入口，后台启动配置损坏：${error instanceof Error ? error.message : String(error)}`);
  }
  if (typeof executable !== 'string' || !isAbsolute(executable) || !existsSync(executable)) {
    throw new Error('CONFIG_CORRUPTED：无法连接单轨本机入口，登记的单轨可执行文件不存在，请重新启动一次单轨');
  }
  return executable;
}

function ensureBackgroundProcess(pipe: string, executable: string, options: DesktopCallOptions): ActiveSpawn {
  const existing = activeSpawns.get(pipe);
  if (existing && !existing.exited && !existing.failedError) return existing;
  const monitor = !options.spawnProcess && process.platform === 'win32'
    ? launchWindowsBackground(executable) : null;
  const child = monitor?.process ?? (options.spawnProcess ?? ((exe: string, args: string[]) =>
    spawn(exe, args, { detached: true, stdio: 'ignore', windowsHide: true })))(executable, ['--background']);
  child.unref();
  const state: ActiveSpawn = {
    process: child,
    release: () => monitor?.release(),
    diagnostics: () => monitor?.diagnostics() ?? '',
    waiters: 0,
    exited: false,
    exitCode: null,
    exitSignal: null,
  };
  child.once('error', error => {
    state.failedError = new Error(`STARTUP_FAILED：无法启动单轨后台进程：${error.message}`);
    if (activeSpawns.get(pipe) === state) activeSpawns.delete(pipe);
  });
  child.once('exit', (code, signal) => {
    state.exited = true;
    state.exitCode = code;
    state.exitSignal = signal;
    if (activeSpawns.get(pipe) === state) activeSpawns.delete(pipe);
  });
  activeSpawns.set(pipe, state);
  return state;
}

function waitRetryOrExit(spawnState: ActiveSpawn, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('CANCELLED：请求在单轨后台启动期间已取消'));
      return;
    }
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, 20);
    const onAbort = () => {
      cleanup();
      reject(new Error('CANCELLED：请求在单轨后台启动期间已取消'));
    };
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      spawnState.process.off('exit', onExit);
      spawnState.process.off('error', onExit);
    };
    const onExit = () => { cleanup(); resolve(); };
    signal?.addEventListener('abort', onAbort, { once: true });
    spawnState.process.once('exit', onExit);
    spawnState.process.once('error', onExit);
  });
}

function sendOverPipe(pipe: string, request: ApplicationRequest, signal?: AbortSignal): Promise<unknown> {
  return new Promise<unknown>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('CANCELLED：请求在发送前已取消'));
      return;
    }
    const socket = createConnection(pipe);
    const lines = createInterface({ input: socket });
    let connected = false;
    let received = false;
    let aborted = false;
    const onAbort = () => {
      aborted = true;
      lines.close();
      socket.destroy();
      reject(new Error(connected
        ? 'CANCELLED_AFTER_SEND：请求已取消；若写操作已进入提交阶段，请通过 get_operation_result 核对结果'
        : 'CANCELLED：请求在连接建立前已取消'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    const cleanup = () => {
      signal?.removeEventListener('abort', onAbort);
    };
    const fail = (error: NodeJS.ErrnoException) => {
      if (aborted) return;
      cleanup();
      if (!connected) {
        reject(error);
        return;
      }
      reject(new Error(`RESULT_UNKNOWN：单轨连接在发送请求后异常中断，请核对原 operation_id：${error.message}`));
    };
    lines.on('error', error => fail(error as NodeJS.ErrnoException));
    socket.on('connect', () => {
      connected = true;
      socket.write(JSON.stringify(request) + '\n');
    });
    socket.on('error', fail);
    socket.on('close', () => {
      cleanup();
      lines.close();
      if (!received && !aborted && connected) {
        reject(new Error('RESULT_UNKNOWN：单轨连接在返回结果前断开，操作结果未知；请通过 get_operation_result 核对后再决定是否重试'));
      }
    });
    lines.once('line', line => {
      received = true;
      cleanup();
      try {
        const reply = JSON.parse(line);
        if (typeof reply.error === 'string') throw new Error(reply.error);
        if (reply.error !== undefined) throw new ApplicationError(applicationErrorSchema.parse(reply.error));
        if (!('result' in reply)) throw new Error('单轨响应缺少结果');
        resolve(reply.result);
      } catch (error) {
        reject(error);
      } finally {
        socket.end();
      }
    });
  });
}

async function sendWhenStarted(pipe: string, request: ApplicationRequest, state: ActiveSpawn, signal?: AbortSignal) {
  state.waiters++;
  try {
    for (;;) {
      if (state.failedError) throw state.failedError;
      try {
        return await sendOverPipe(pipe, request, signal);
      } catch (error) {
        const failure = error as NodeJS.ErrnoException;
        if (failure.code === 'EACCES' || failure.code === 'EPERM') {
          throw new Error(`PIPE_PERMISSION_DENIED：无法连接单轨本机入口，管道访问被拒绝（${failure.code}）：${failure.message}`, { cause: error });
        }
        if (failure.code === 'EBUSY') throw new Error('PIPE_BUSY：单轨已运行但连接繁忙；本次未发送请求，请稍后重试', { cause: error });
        if (failure.code !== 'ENOENT') throw error;
        if (state.failedError) throw state.failedError;
        if (state.exited) {
          const details = state.diagnostics();
          throw new Error(`STARTUP_FAILED：单轨后台进程在就绪前退出（code=${String(state.exitCode)}, signal=${String(state.exitSignal)}）${details ? `：${details}` : ''}`);
        }
        await waitRetryOrExit(state, signal);
      }
    }
  } finally {
    state.waiters--;
    // One caller cancelling must not discard another caller's startup observer.
    if (state.waiters === 0) {
      if (activeSpawns.get(pipe) === state) activeSpawns.delete(pipe);
      state.release();
    }
  }
}

export async function callDesktop(pipe: string, request: ApplicationRequest, options: DesktopCallOptions = {}) {
  for (;;) {
    try {
      return await sendOverPipe(pipe, request, options.signal);
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === 'EACCES' || err.code === 'EPERM') {
        throw new Error(`PIPE_PERMISSION_DENIED：无法连接单轨本机入口，管道访问被拒绝（${err.code}）：${err.message}`, { cause: error });
      }
      // EBUSY means the named pipe exists (desktop is already running) and is momentarily accepting another connection;
      // never treat EBUSY as "not running" or spawn a second process.
      if (err.code === 'EBUSY') {
        throw new Error('PIPE_BUSY：单轨已运行但连接繁忙；本次未发送请求，请稍后重试', { cause: error });
      }
      if (err.code !== 'ENOENT') {
        if (err.code) {
          throw new Error(`UNAVAILABLE：无法连接单轨本机入口，请确认新版单轨已启动并打开数据目录：${err.message}`, { cause: error });
        }
        throw error;
      }
      if (options.autoStart === false) {
        throw new Error(`UNAVAILABLE：无法连接单轨本机入口，请确认新版单轨已启动并打开数据目录：${err.message}`, { cause: error });
      }
      const configDir = resolveConfigDir(pipe, options);
      if (!configDir) {
        throw new Error(`UNAVAILABLE：无法连接单轨本机入口，请确认新版单轨已启动并打开数据目录：${err.message}`, { cause: error });
      }
      const executable = validateLaunchTarget(configDir, options);
      const spawnState = ensureBackgroundProcess(pipe, executable, options);
      return await sendWhenStarted(pipe, request, spawnState, options.signal);
    }
  }
}

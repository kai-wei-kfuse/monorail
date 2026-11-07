// 0.3.2 隔离原生实测公共工具：独立 identifier、基线快照（证明日常版零触碰）、进程启停、WebView2 CDP 连接。
import { execFileSync, spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';

export const here = resolve('evidence/0.3.2-isolated');
export const sleep = ms => new Promise(r => setTimeout(r, ms));
export const loadEnv = async () => JSON.parse(await readFile(join(here, 'env.json'), 'utf8'));
export const ps = (script, opts = {}) => execFileSync('powershell.exe', ['-NoProfile', '-Command',
  `$OutputEncoding = [Console]::OutputEncoding = [System.Text.Encoding]::UTF8; ${script}`], { encoding: 'utf8', ...opts }).trim();
const q = s => `'${String(s).replaceAll("'", "''")}'`;

export const DAILY = {
  exe: join(process.env.LOCALAPPDATA, '单轨', 'pixel-record.exe'),
  config: join(process.env.APPDATA, 'local.pixelrecord.app', 'config.json'),
};

const sha = p => existsSync(p) ? createHash('sha256').update(readFileSync(p)).digest('hex') : null;

export function baseline() {
  const got = JSON.parse(ps(`
$run = @{}; (Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run').PSObject.Properties | Where-Object { $_.Name -notlike 'PS*' } | ForEach-Object { $run[$_.Name] = [string]$_.Value }
$p = Get-Process -Name 'pixel-record' -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq ${q(DAILY.exe)} } | Select-Object -First 1
@{ run = $run; pid = if ($p) { $p.Id } else { $null } } | ConvertTo-Json -Depth 4 -Compress`));
  return { run: got.run, daily: { pid: got.pid, exe: sha(DAILY.exe), config: sha(DAILY.config) } };
}

export function kill(exe) {
  if (exe === DAILY.exe) throw new Error('Refusing to kill daily executable');
  try {
    ps(`Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq ${q(exe)} } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`, { stdio: 'ignore' });
  } catch {}
}

export const count = exe => Number(ps(`@(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq ${q(exe)} }).Count`));

export function launch(exe, port, args = []) {
  if (exe === DAILY.exe) throw new Error('Refusing to launch daily executable');
  const child = spawn(exe, args, {
    env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}` },
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  return child;
}

export async function connect(port, label = 'main', tries = 120) {
  for (let i = 0; i < tries; i++) {
    let targets = [];
    try {
      targets = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).filter(t => t.type === 'page' && t.webSocketDebuggerUrl);
    } catch {}
    for (const t of targets) {
      const page = await open(t.webSocketDebuggerUrl).catch(() => null);
      if (!page) continue;
      const got = await page.eval('window.__TAURI_INTERNALS__?.metadata?.currentWindow?.label').catch(() => null);
      if (got === label) {
        await page.call('Page.enable');
        await page.call('Runtime.enable');
        return page;
      }
      page.close();
    }
    await sleep(250);
  }
  throw new Error(`CDP: no '${label}' window on port ${port}`);
}

async function open(url) {
  const ws = new WebSocket(url);
  await new Promise((ok, bad) => {
    ws.addEventListener('open', ok, { once: true });
    ws.addEventListener('error', bad, { once: true });
  });
  let id = 0;
  const pending = new Map();
  const errors = [];
  ws.addEventListener('message', e => {
    const m = JSON.parse(String(e.data));
    if (m.id && pending.has(m.id)) {
      const { ok, bad } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? bad(new Error(m.error.message)) : ok(m.result);
    }
    if (m.method === 'Runtime.exceptionThrown') {
      errors.push(m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text);
    }
  });
  const call = (method, params = {}) =>
    new Promise((ok, bad) => {
      const n = ++id;
      pending.set(n, { ok, bad });
      ws.send(JSON.stringify({ id: n, method, params }));
    });
  const page = {
    call,
    errors,
    close: () => { try { ws.close(); } catch {} },
    async eval(expression) {
      const r = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
      return r.result.value;
    },
    async waitFor(expression, ms = 15_000, label = expression) {
      const end = Date.now() + ms;
      for (;;) {
        const v = await page.eval(expression).catch(() => null);
        if (v) return v;
        if (Date.now() > end) throw new Error(`timeout: ${label}`);
        await sleep(150);
      }
    },
    text: () => page.eval('document.body?.innerText ?? ""'),
    async click(selector, text) {
      const ok = await page.eval(`(() => {
        const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find(e => ${text === undefined ? 'true' : `(e.textContent ?? '').includes(${JSON.stringify(text)})`});
        if (!el) return false;
        el.click();
        return true;
      })()`);
      if (!ok) throw new Error(`click: ${selector} ${text ?? ''}`);
      await sleep(250);
    },
    async rect(selector, text) {
      return page.eval(`(() => {
        const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find(e => ${text === undefined ? 'true' : `(e.textContent ?? '').includes(${JSON.stringify(text)})`});
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height, left: r.left, right: r.right, top: r.top, bottom: r.bottom };
      })()`);
    },
    async mouse(type, x, y, buttons = 1) {
      await call('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : buttons, clickCount: 1, pointerType: 'mouse' });
    },
    async key(key, code = key, text) {
      await call('Input.dispatchKeyEvent', { type: 'keyDown', key, code, ...(text ? { text } : {}), windowsVirtualKeyCode: VK[key] ?? 0 });
      await call('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: VK[key] ?? 0 });
    },
    type: text => call('Input.insertText', { text }),
    async shot(path) {
      await page.eval(`document.querySelectorAll('.toast-host, .toasts').forEach(e => e.style.visibility = 'hidden')`).catch(() => {});
      await sleep(150);
      const s = await call('Page.captureScreenshot', { format: 'png' });
      await writeFile(path, Buffer.from(s.data, 'base64'));
      await page.eval(`document.querySelectorAll('.toast-host, .toasts').forEach(e => e.style.visibility = '')`).catch(() => {});
    },
    invoke: (cmd, args = {}) => page.eval(`window.__TAURI_INTERNALS__.invoke(${JSON.stringify(cmd)}, ${JSON.stringify(args)})`),
  };
  return page;
}

const VK = { Enter: 13, Escape: 27, Tab: 9, Backspace: 8, F5: 116 };

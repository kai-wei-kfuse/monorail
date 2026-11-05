// 0.3.1 隔离实测的公共工具（照 beta4-isolated/lib.mjs，执行方案 G9）：隔离身份、基线快照、启停、WebView2 CDP。
// 只操作本目录 env.json 里登记的隔离身份与临时目录；日常版（local.pixelrecord.app）只读不写。
import { execFileSync, spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';

export const here = resolve('evidence/0.3.1-isolated');
export const sleep = ms => new Promise(r => setTimeout(r, ms));
export const loadEnv = async () => JSON.parse(await readFile(join(here, 'env.json'), 'utf8'));
export const ps = (script, opts = {}) => execFileSync('powershell.exe', ['-NoProfile', '-Command',
  `$OutputEncoding = [Console]::OutputEncoding = [System.Text.Encoding]::UTF8; ${script}`], { encoding: 'utf8', ...opts }).trim();
const q = s => `'${String(s).replaceAll("'", "''")}'`;

export const DAILY = { exe: join(process.env.LOCALAPPDATA, '单轨', 'pixel-record.exe'), config: join(process.env.APPDATA, 'local.pixelrecord.app', 'config.json') };
/** Run 项、日常版进程与文件哈希：前后各取一次，证明没碰日常版。 */
const sha = p => existsSync(p) ? createHash('sha256').update(readFileSync(p)).digest('hex') : null;
export function baseline() {
  const got = JSON.parse(ps(`
$run = @{}; (Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run').PSObject.Properties | Where-Object { $_.Name -notlike 'PS*' } | ForEach-Object { $run[$_.Name] = [string]$_.Value }
$p = Get-Process -Name 'pixel-record' -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq ${q(DAILY.exe)} } | Select-Object -First 1
@{ run = $run; pid = if ($p) { $p.Id } else { $null } } | ConvertTo-Json -Depth 4 -Compress`));
  return { run: got.run, daily: { pid: got.pid, exe: sha(DAILY.exe), config: sha(DAILY.config) } };
}
export function kill(exe) {
  try { ps(`Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq ${q(exe)} } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`, { stdio: 'ignore' }); } catch {}
}
export const count = exe => Number(ps(`@(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq ${q(exe)} }).Count`));
export function launch(exe, port, args = []) {
  const child = spawn(exe, args, { env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}` }, detached: true, stdio: 'ignore' });
  child.unref();
  return child;
}
export async function evidenceLines(profile) {
  const p = join(profile, 'evidence.jsonl');
  return existsSync(p) ? (await readFile(p, 'utf8')).trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
}

/** 连上指定窗口（main / quickbar / mini）的 WebView2 页面。 */
export async function connect(port, label = 'main', tries = 120) {
  for (let i = 0; i < tries; i++) {
    let targets = [];
    try { targets = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).filter(t => t.type === 'page' && t.webSocketDebuggerUrl); } catch {}
    for (const t of targets) {
      const page = await open(t.webSocketDebuggerUrl).catch(() => null);
      if (!page) continue;
      const got = await page.eval('window.__TAURI_INTERNALS__?.metadata?.currentWindow?.label').catch(() => null);
      if (got === label) { await page.call('Page.enable'); await page.call('Runtime.enable'); return page; }
      page.close();
    }
    await sleep(250);
  }
  throw new Error(`CDP: no '${label}' window on port ${port}`);
}
async function open(url) {
  const ws = new WebSocket(url);
  await new Promise((ok, bad) => { ws.addEventListener('open', ok, { once: true }); ws.addEventListener('error', bad, { once: true }); });
  let id = 0; const pending = new Map(), errors = [];
  ws.addEventListener('message', e => {
    const m = JSON.parse(String(e.data));
    if (m.id && pending.has(m.id)) { const { ok, bad } = pending.get(m.id); pending.delete(m.id); m.error ? bad(new Error(m.error.message)) : ok(m.result); }
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text);
  });
  const call = (method, params = {}) => new Promise((ok, bad) => { const n = ++id; pending.set(n, { ok, bad }); ws.send(JSON.stringify({ id: n, method, params })); });
  const page = {
    call, errors, close: () => { try { ws.close(); } catch {} },
    /** 在页面里求值；表达式可以返回 Promise。 */
    async eval(expression) {
      const r = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
      return r.result.value;
    },
    async waitFor(expression, ms = 15_000, label = expression) {
      const end = Date.now() + ms;
      for (;;) { const v = await page.eval(expression).catch(() => null); if (v) return v; if (Date.now() > end) throw new Error(`timeout: ${label}`); await sleep(150); }
    },
    text: () => page.eval('document.body?.innerText ?? ""'),
    /** 点第一个文字包含 text 的元素（selector 限定范围）。 */
    async click(selector, text) {
      const ok = await page.eval(`(() => { const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find(e => ${text === undefined ? 'true' : `(e.textContent ?? '').includes(${JSON.stringify(text)})`});
        if (!el) return false; el.scrollIntoView({ block: 'center' }); el.click(); return true; })()`);
      if (!ok) throw new Error(`click: ${selector} ${text ?? ''}`);
      await sleep(250);
    },
    async rect(selector, text) {
      return page.eval(`(() => { const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find(e => ${text === undefined ? 'true' : `(e.textContent ?? '').includes(${JSON.stringify(text)})`});
        if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
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
    /** 主窗口的 Tauri invoke（只用于读状态或显示窗口，不绕过界面去改数据）。 */
    invoke: (cmd, args = {}) => page.eval(`window.__TAURI_INTERNALS__.invoke(${JSON.stringify(cmd)}, ${JSON.stringify(args)})`),
  };
  return page;
}
const VK = { Enter: 13, Escape: 27, Tab: 9, Backspace: 8, F5: 116 };

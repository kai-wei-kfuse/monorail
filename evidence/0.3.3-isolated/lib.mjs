import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const sleep = ms => new Promise(r => setTimeout(r, ms));
export const sha256 = p => (existsSync(p) ? createHash('sha256').update(readFileSync(p)).digest('hex') : null);

export function ps(script) {
  return execFileSync('powershell.exe', ['-NoProfile', '-Command', script], { encoding: 'utf8' }).trim();
}

export function baseline() {
  const dailyExe = join(process.env.LOCALAPPDATA, '单轨', 'pixel-record.exe');
  const dailyCfg = join(process.env.APPDATA, 'local.pixelrecord.app', 'config.json');
  const runJson = ps(
    "Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run' | Select-Object * -ExcludeProperty PS* | ConvertTo-Json -Compress",
  );
  const pids = ps(
    "Get-CimInstance Win32_Process -Filter \"Name='pixel-record.exe'\" | Select-Object ProcessId,ExecutablePath | ConvertTo-Json -Compress",
  );
  return {
    at: new Date().toISOString(),
    run: runJson ? JSON.parse(runJson) : {},
    daily: {
      exe: dailyExe,
      exeSha256: sha256(dailyExe),
      config: dailyCfg,
      configSha256: sha256(dailyCfg),
      processes: pids ? JSON.parse(pids) : [],
    },
  };
}

export class CdpPage {
  constructor(wsUrl, targetId = null) {
    this.wsUrl = wsUrl;
    this.targetId = targetId;
    this.id = 0;
    this.pending = new Map();
    this.closed = false;
  }
  async connect(timeoutMs = 5000) {
    this.ws = new WebSocket(this.wsUrl);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        try {
          this.ws.close();
        } catch {}
        reject(new Error(`CDP connect timeout: ${this.wsUrl}`));
      }, timeoutMs);
      this.ws.addEventListener(
        'open',
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
      this.ws.addEventListener(
        'error',
        err => {
          clearTimeout(timer);
          reject(err);
        },
        { once: true },
      );
    });
    const rejectAll = reason => {
      this.closed = true;
      for (const [, { reject, timer }] of this.pending) {
        clearTimeout(timer);
        reject(new Error(reason));
      }
      this.pending.clear();
    };
    this.ws.addEventListener('close', () => rejectAll('CDP WebSocket closed'));
    this.ws.addEventListener('error', () => rejectAll('CDP WebSocket error'));
    this.ws.addEventListener('message', ev => {
      const msg = JSON.parse(String(ev.data));
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject, timer } = this.pending.get(msg.id);
        clearTimeout(timer);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      }
    });
  }
  send(method, params = {}, timeoutMs = 8000) {
    if (this.closed || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error(`CDP socket not open for ${method}`));
    }
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP send timeout (${method})`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
    });
  }
  async eval(expression, timeoutMs = 8000) {
    const res = await this.send(
      'Runtime.evaluate',
      {
        expression,
        awaitPromise: true,
        returnByValue: true,
      },
      timeoutMs,
    );
    if (res.exceptionDetails) {
      throw new Error(`JS error: ${res.exceptionDetails.text} ${JSON.stringify(res.result)}`);
    }
    return res.result?.value;
  }
  async screenshot(path) {
    mkdirSync(join(path, '..'), { recursive: true });
    const res = await this.send('Page.captureScreenshot', { format: 'png' }, 10000);
    writeFileSync(path, Buffer.from(res.data, 'base64'));
  }
  close() {
    this.closed = true;
    try {
      this.ws?.close();
    } catch {}
  }
}

const knownTargetLabels = new Map();

export async function listTargetsWithLabels(port) {
  const resp = await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(3000) });
  if (!resp.ok) {
    throw new Error(`CDP /json HTTP ${resp.status} on port ${port}`);
  }
  const list = await resp.json();
  if (!Array.isArray(list) || list.length === 0) {
    throw new Error(`CDP /json returned empty target list on port ${port}`);
  }
  const out = [];
  for (const t of list) {
    if (t.type !== 'page' || !t.webSocketDebuggerUrl) continue;
    if (knownTargetLabels.has(t.id)) {
      out.push({
        label: knownTargetLabels.get(t.id),
        title: t.title,
        url: t.url,
        wsUrl: t.webSocketDebuggerUrl,
        targetId: t.id,
      });
      continue;
    }
    const p = new CdpPage(t.webSocketDebuggerUrl, t.id);
    try {
      await p.connect(2500);
      const current = await p.eval('window.__TAURI_INTERNALS__?.metadata?.currentWindow?.label || ""', 2500);
      p.close();
      if (!current) {
        throw new Error(`CDP target ${t.id} returned empty window label`);
      }
      knownTargetLabels.set(t.id, current);
      out.push({ label: current, title: t.title, url: t.url, wsUrl: t.webSocketDebuggerUrl, targetId: t.id });
    } catch (err) {
      p.close();
      throw new Error(`Failed to inspect CDP target ${t.id} (${t.title}): ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return out;
}

export async function assertWindowClosedWithMainAlive(port, mainPage, closedLabel, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  let lastLabels = [];
  while (Date.now() < deadline) {
    const mainProbe = await mainPage.eval('window.__TAURI_INTERNALS__?.metadata?.currentWindow?.label');
    if (mainProbe !== 'main') {
      throw new Error(`Main window CDP probe failed while checking closure of ${closedLabel}: got ${String(mainProbe)}`);
    }
    try {
      const list = await listTargetsWithLabels(port);
      lastLabels = list.map(t => t.label);
      if (!lastLabels.includes('main')) {
        throw new Error(`CDP target list missing 'main' while checking closure of ${closedLabel}: ${JSON.stringify(lastLabels)}`);
      }
      if (!lastLabels.includes(closedLabel)) {
        return { closed: true, mainAlive: true, remainingLabels: lastLabels };
      }
    } catch (err) {
      // If a target is mid-destruction during the poll, retry until deadline, but never treat error as closed
      lastLabels = [`ERROR: ${err instanceof Error ? err.message : String(err)}`];
    }
    await sleep(200);
  }
  throw new Error(`Window ${closedLabel} did not close within ${timeoutMs}ms; lastLabels=${JSON.stringify(lastLabels)}`);
}

export function postWmCloseToIdeaWindow(pid) {
  const script = `
Add-Type @"
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public class Win32IdeaClose {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
  [DllImport("user32.dll")] public static extern bool PostMessageW(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);
  public static List<string> CloseIdeaWindows(uint targetPid) {
    var closed = new List<string>();
    EnumWindows((hWnd, lParam) => {
      uint wpid = 0;
      GetWindowThreadProcessId(hWnd, out wpid);
      if (wpid == targetPid && IsWindowVisible(hWnd)) {
        var sb = new StringBuilder(256);
        GetWindowText(hWnd, sb, 256);
        var title = sb.ToString();
        if (title.Contains("想法") || (!title.Contains("0.3.3") && title.Length > 0 && !title.Contains("快速"))) {
          PostMessageW(hWnd, 0x0010, IntPtr.Zero, IntPtr.Zero);
          closed.Add("0x" + hWnd.ToInt64().ToString("X") + ":" + title);
        }
      }
      return true;
    }, IntPtr.Zero);
    return closed;
  }
}
"@
$res = [Win32IdeaClose]::CloseIdeaWindows(${Number(pid)})
if ($res.Count -eq 0) { throw "No visible Idea Window HWND found for PID ${Number(pid)}" }
ConvertTo-Json -InputObject @($res) -Compress
`;
  return JSON.parse(ps(script));
}

export async function findTarget(port, label, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const list = await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(3000) }).then(r => r.json());
      for (const t of list) {
        if (t.type !== 'page' || !t.webSocketDebuggerUrl) continue;
        const cachedLabel = knownTargetLabels.get(t.id);
        if (cachedLabel && cachedLabel !== label) continue;
        const p = new CdpPage(t.webSocketDebuggerUrl, t.id);
        try {
          await p.connect(2500);
          const current = await p.eval('window.__TAURI_INTERNALS__?.metadata?.currentWindow?.label || ""', 2500);
          if (current) knownTargetLabels.set(t.id, current);
          if (current === label) return p;
          p.close();
        } catch {
          p.close();
        }
      }
    } catch {}
    await sleep(250);
  }
  throw new Error(`CDP target not found for window label: ${label}`);
}

export async function waitFor(page, fnExpr, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await page.eval(fnExpr);
    if (last) return last;
    await sleep(180);
  }
  let diag = {};
  try {
    diag = await page.eval(`({
      taValue: document.querySelector('.note-win-ta')?.value,
      conflict: document.querySelector('.note-win-conflict')?.innerText,
      syncText: document.querySelector('.note-win-dock-right')?.innerText,
      topMeta: document.querySelector('.note-win-topmeta')?.innerText,
      bodySnippet: document.body?.innerText?.slice(0, 400),
    })`);
  } catch {}
  throw new Error(`Timeout waiting for: ${fnExpr}; last=${JSON.stringify(last)}; diag=${JSON.stringify(diag)}`);
}

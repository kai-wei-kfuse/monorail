import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const base = process.argv[2];
if (!base) throw new Error('Usage: node focus-check.mjs <gallery-server-url>');
const profile = mkdtempSync(join(tmpdir(), 'monorail-focus-'));
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
  '--window-size=1280,900', 'about:blank',
], { stdio: 'ignore' });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let ws;
try {
  const portFile = join(profile, 'DevToolsActivePort');
  while (!existsSync(portFile)) {
    if (chrome.exitCode !== null) throw new Error('Chrome exited before DevTools became available');
    await pause(100);
  }
  const port = readFileSync(portFile, 'utf8').split('\n')[0].trim();
  const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  ws = new WebSocket(pages.find(page => page.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (!pending.has(message.id)) return;
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const next = ++id;
    pending.set(next, { resolve, reject });
    ws.send(JSON.stringify({ id: next, method, params }));
  });
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  let currentPage = '';
  for (const { page, selector, name } of [
    { page: 'timer', selector: '#elapsed', name: 'timer' },
    { page: 'timer', selector: '#card', name: 'card' },
    { page: 'mini', selector: '#mini-elapsed', name: 'mini' },
  ]) {
    if (page !== currentPage) {
      await send('Page.navigate', { url: `${base}/gallery.html?page=${page}` });
      while (!await evaluate(`location.search.includes(${JSON.stringify(`page=${page}`)}) && !!document.querySelector(${JSON.stringify(selector)})`)) await pause(100);
      currentPage = page;
    }
    await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
    while (!await evaluate(`!!document.querySelector(${JSON.stringify(`${selector}.time-in`)})`)) await pause(100);
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
    const observed = await evaluate(`(() => {
      const input = document.querySelector(${JSON.stringify(selector)}), style = getComputedStyle(input);
      return { focused: document.activeElement === input, focusVisible: input.matches(':focus-visible'),
        selectionStart: input.selectionStart, selectionEnd: input.selectionEnd, length: input.value.length,
        outlineStyle: style.outlineStyle, borderWidth: style.borderTopWidth,
        background: style.backgroundColor, shadow: style.boxShadow };
    })()`);
    assert.equal(observed.focused, true, `${name}: input must receive focus`);
    assert.equal(observed.focusVisible, true, `${name}: exercise focus-visible`);
    assert.equal(observed.selectionStart, observed.length, `${name}: cursor must be at the end`);
    assert.equal(observed.selectionEnd, observed.length, `${name}: text must not be selected`);
    assert.equal(observed.outlineStyle, 'none', `${name}: editing must not show a focus outline`);
    assert.equal(observed.borderWidth, '0px', `${name}: editing must not show a border`);
    assert.equal(observed.background, 'rgba(0, 0, 0, 0)', `${name}: editing must be transparent`);
    assert.notEqual(observed.shadow, 'none', `${name}: editing must keep its underline`);
    const screenshot = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(new URL(`${name}-focus-fixed.png`, import.meta.url), Buffer.from(screenshot.data, 'base64'));
    console.log(`${name}: passed ${JSON.stringify(observed)}`);
  }
} finally {
  if (ws) ws.close();
  chrome.kill();
}

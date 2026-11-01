// Independent headless Chromium test; it never attaches to the user's application or browser profile.
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const profile = await mkdtemp(join(tmpdir(), 'monorail-away-controls-'));
const browser = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--window-size=1120,900', 'about:blank',
], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
// Existing project policy gives verification processes a whole-process 60-second deadline.
const deadline = setTimeout(() => { browser.kill(); console.error('TEST_PROCESS_TIMEOUT: 60 seconds'); process.exit(1); }, 60_000);
let socket;
try {
  const port = await new Promise((resolve, reject) => {
    let log = '';
    browser.stderr.on('data', chunk => {
      log += chunk;
      const match = /DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)/.exec(log);
      if (match) resolve(match[1]);
    });
    browser.once('error', reject);
    browser.once('exit', code => reject(new Error(`Browser exited before ready: ${code}`)));
  });
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  socket = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  let id = 0;
  const pending = new Map();
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data), request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error) request.reject(new Error(JSON.stringify(message.error)));
    else request.resolve(message.result);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const requestId = ++id; pending.set(requestId, { resolve, reject }); socket.send(JSON.stringify({ id: requestId, method, params }));
  });
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const waitFor = expression => evaluate(`new Promise(resolve => { const check = () => { if (${expression}) resolve(true); else requestAnimationFrame(check); }; check(); })`);
  const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  await send('Page.enable');
  const rows = [];
  for (const layout of ['fused', 'split']) for (const state of ['idle', 'free', 'pending', 'card']) {
    await send('Page.navigate', { url: `http://127.0.0.1:1437/gallery.html?page=live&still&layout=${layout}` });
    await waitFor(`document.querySelector('#dev-away-wc')`);
    if (state === 'free' || state === 'pending') {
      await click(layout === 'fused' ? '.home .actions .abtn' : '.tbar-acts .abtn');
      await waitFor(`document.querySelector('#state').textContent.includes('待确认：') && !document.querySelector('#state').textContent.includes('待确认：无')`);
      if (state === 'free') {
        await evaluate(`document.querySelector('#what').focus()`);
        await send('Input.insertText', { text: '验证原活动' });
        await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
        await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
        await waitFor(`document.querySelector('#state').textContent.includes('验证原活动') && document.querySelector('#state').textContent.includes('待确认：无')`);
      }
    }
    if (state === 'card') {
      await evaluate(`Array.from(document.querySelectorAll('.home .activity-actions button')).find(button => button.textContent.includes('抽')).click()`);
      await waitFor(`document.querySelector('#state').textContent.includes('卡：改') || document.querySelector('#state').textContent.includes('卡：投')`);
    }
    await click('#dev-away-wc');
    await waitFor(`document.querySelector('.away-back')`);
    const before = await evaluate(`document.querySelector('#state').innerText`);
    const controls = await evaluate(`Array.from(document.querySelectorAll('.home .activity-actions button')).map(button => {
      const group = button.closest('fieldset'), rect = button.getBoundingClientRect();
      button.focus();
      return { text: button.textContent, disabled: button.matches(':disabled'), focusBlocked: document.activeElement !== button,
        title: group.title, filter: getComputedStyle(group).filter, opacity: getComputedStyle(button).opacity,
        x: rect.x + rect.width / 2, y: rect.y + rect.height / 2,
        hoverTitle: document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)?.closest('fieldset')?.title };
    })`);
    assert.ok(controls.length > 0);
    for (const control of controls) {
      assert.equal(control.disabled, true);
      assert.equal(control.focusBlocked, true);
      assert.equal(control.title, '从临时活动回来后可用');
      assert.equal(control.hoverTitle, control.title);
      assert.equal(control.filter, 'grayscale(1)');
      assert.ok(Number(control.opacity) < 1);
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: control.x, y: control.y, button: 'left', clickCount: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: control.x, y: control.y, button: 'left', clickCount: 1 });
    }
    assert.equal(await evaluate(`document.querySelector('#state').innerText`), before);
    assert.equal(await evaluate(`document.querySelector('.away-back').matches(':disabled')`), false);
    if (state === 'free') {
      const screenshot = await send('Page.captureScreenshot', { format: 'png' });
      await writeFile(`evidence/ui-0.2.5/away-disabled-${layout}.png`, Buffer.from(screenshot.data, 'base64'));
    }
    await click('.away-back');
    await waitFor(`!document.querySelector('.away-back')`);
    assert.equal(await evaluate(`!!document.querySelector('.activity-actions[disabled]')`), false);
    const restored = await evaluate(`Array.from(document.querySelectorAll('.home .activity-actions button')).map(button => ({ text: button.textContent, disabled: button.matches(':disabled') }))`);
    assert.ok(restored.some(control => !control.disabled));
    rows.push({ layout, state, controls, restored, clicksDidNotChangeState: true, returnEnabled: true });
  }
  await writeFile('evidence/ui-0.2.5/away-disabled-browser.json', JSON.stringify({ status: 'passed', rows }, null, 2));
  console.log(`PASS: ${rows.length} real-browser scenarios; disabled, gray, hover reason, click/focus blocked and return recovery.`);
} finally {
  socket?.close();
  browser.kill();
  clearTimeout(deadline);
}

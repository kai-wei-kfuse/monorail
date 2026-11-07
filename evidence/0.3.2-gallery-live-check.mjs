// Headless browser verification of real Gallery LivePreview (Requirement #1/#7 QuestDetail + Requirement #5 Bag Start Wipe + Requirement #4 Explicit Insert Draft/Cancel/Commit).
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const profile = await mkdtemp(join(tmpdir(), 'monorail-032-gallery-live-'));
const shotsDir = resolve('evidence/0.3.2-gallery-shots');
await mkdir(shotsDir, { recursive: true });

const chrome = spawn(
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  [
    '--headless=new',
    '--remote-debugging-port=9340',
    `--user-data-dir=${profile}`,
    '--hide-scrollbars',
    'about:blank',
  ],
  { stdio: ['ignore', 'ignore', 'pipe'] },
);

let ws;
const delay = ms => new Promise(r => setTimeout(r, ms));

try {
  let target;
  for (let i = 0; i < 50 && !target; i++) {
    await delay(200);
    try {
      const list = await (await fetch('http://127.0.0.1:9340/json')).json();
      target = list.find(t => t.type === 'page');
    } catch (error) {
      if (i === 49) throw new Error('Headless Chrome did not expose CDP on 9340', { cause: error });
    }
  }
  if (!target) throw new Error('No headless Chrome page target');

  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((ok, bad) => {
    ws.addEventListener('open', ok, { once: true });
    ws.addEventListener('error', bad, { once: true });
  });

  let id = 0;
  const requests = new Map();
  const runtimeErrors = [];
  ws.addEventListener('message', e => {
    const m = JSON.parse(String(e.data));
    if (m.id && requests.has(m.id)) {
      const { ok, bad } = requests.get(m.id);
      requests.delete(m.id);
      m.error ? bad(new Error(m.error.message)) : ok(m.result);
    }
    if (m.method === 'Runtime.exceptionThrown') {
      runtimeErrors.push(m.params.exceptionDetails.text);
    }
  });

  const call = (method, params = {}) =>
    new Promise((ok, bad) => {
      const n = ++id;
      requests.set(n, { ok, bad });
      ws.send(JSON.stringify({ id: n, method, params }));
    });

  const evaluate = async expression => {
    const r = await call('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.exceptionDetails) {
      throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    }
    return r.result.value;
  };

  const shot = async name => {
    const { data } = await call('Page.captureScreenshot', { format: 'png' });
    const file = join(shotsDir, name);
    await writeFile(file, Buffer.from(data, 'base64'));
    return `evidence/0.3.2-gallery-shots/${name}`;
  };

  await call('Page.enable');
  await call('Runtime.enable');
  await call('Emulation.setDeviceMetricsOverride', {
    width: 1280,
    height: 820,
    deviceScaleFactor: 1,
    mobile: false,
  });

  await call('Page.navigate', {
    url: 'http://127.0.0.1:1428/gallery.html?page=live&layout=fused&bag&bagOpen',
  });

  for (let i = 0; i < 50; i++) {
    if (await evaluate('!!document.querySelector(".bp-drawer[data-open] .bq .bp-more")')) break;
    await delay(200);
  }

  // 1. Open QuestDetail and verify Requirement #1 & #7 buttons
  await evaluate('document.querySelector(".bp-drawer[data-open] .bq .bp-more").click()');
  await delay(250);
  const detailButtons = await evaluate(`(() => {
    const detail = document.querySelector('.bp-detail');
    if (!detail) return null;
    const itemBtns = [...detail.querySelectorAll('.bp-it .acts .bp-btn')].map(b => b.textContent.trim());
    const footBtns = [...detail.querySelectorAll('.bp-dfoot .bp-btn')].map(b => b.textContent.trim());
    const checkboxes = detail.querySelectorAll('.bp-it button.st').length;
    return { itemBtns, footBtns, checkboxes };
  })()`);
  const detailShot = await shot('gallery-quest-detail.png');

  // Toggle first sub-task complete -> then reopen back to pending
  await evaluate(`(() => {
    const btn = [...document.querySelectorAll('.bp-detail .bp-it .acts .bp-btn')].find(b => b.textContent.trim() === '完成');
    if (!btn) throw new Error('Missing sub-task complete button');
    btn.click();
  })()`);
  await delay(250);
  const afterSubtaskComplete = await evaluate(`(() => ({
    doneRows: document.querySelectorAll('.bp-detail .bp-it.done').length,
    reopenBtnText: document.querySelector('.bp-detail .bp-it.done .acts .bp-btn')?.textContent?.trim() ?? null,
  }))()`);
  const subtaskDoneShot = await shot('gallery-subtask-done-and-reopen.png');

  await evaluate(`(() => {
    const btn = document.querySelector('.bp-detail .bp-it.done .acts .bp-btn');
    if (!btn) throw new Error('Missing sub-task reopen button');
    btn.click();
  })()`);
  await delay(250);
  const afterSubtaskReopen = await evaluate(`document.querySelectorAll('.bp-detail .bp-it.done').length`);

  // 2. Install Wipe MutationObserver on #root and click [开始] on first sub-task in QuestDetail
  await evaluate(`(() => {
    window.__galleryWipe = { wipeMounts: 0, frames: [] };
    const root = document.getElementById('root');
    new MutationObserver(records => {
      for (const rec of records) {
        for (const node of rec.addedNodes) {
          if (node instanceof HTMLElement && (node.classList.contains('wipe') || node.querySelector?.('.wipe'))) {
            window.__galleryWipe.wipeMounts++;
            window.__galleryWipe.frames.push({ at: Math.round(performance.now()), text: node.innerText?.trim() ?? '' });
          }
        }
      }
    }).observe(root, { childList: true, subtree: true });
  })()`);

  await evaluate(`(() => {
    const go = document.querySelector('.bp-detail .bp-it .bp-go');
    if (!go) throw new Error('Missing sub-task start button');
    go.click();
  })()`);
  await delay(260);
  const wipeShot = await shot('gallery-bag-start-wipe.png');
  await delay(1400);
  const wipeResult = await evaluate('window.__galleryWipe');

  // 3. Explicit insert draft -> cancel -> commit on running card
  const entriesBeforeDraft = await evaluate('document.querySelectorAll("#state ol li").length');
  await evaluate(`(() => {
    const btn = [...document.querySelectorAll('.c-rest')].find(b => b.textContent.includes('插入事件'));
    if (!btn) throw new Error('Missing explicit insert button on card');
    btn.click();
  })()`);
  await delay(300);
  const draftState = await evaluate(`(() => ({
    hasInput: !!document.querySelector('#ins-what'),
    entriesDuringDraft: document.querySelectorAll('#state ol li').length,
    stateLine: document.querySelector('#state > div')?.textContent?.trim() ?? '',
  }))()`);
  const draftShot = await shot('gallery-explicit-insert-draft.png');

  // Cancel draft via [回到任务] (.ins-up-back)
  await evaluate(`(() => {
    const cancelBtn = document.querySelector('.ins-up-back');
    if (!cancelBtn) throw new Error('Missing cancel draft button (.ins-up-back)');
    cancelBtn.click();
  })()`);
  await delay(400);
  const afterCancelDraft = await evaluate(`(() => ({
    hasInput: !!document.querySelector('#ins-what'),
    entriesAfterCancel: document.querySelectorAll('#state ol li').length,
    stateLine: document.querySelector('#state > div')?.textContent?.trim() ?? '',
  }))()`);

  // Begin draft again and commit '接电话'
  await evaluate(`(() => {
    const btn = [...document.querySelectorAll('.c-rest')].find(b => b.textContent.includes('插入事件'));
    if (!btn) throw new Error('Missing explicit insert button on second click');
    btn.click();
  })()`);
  await delay(300);
  await evaluate(`document.querySelector('#ins-what')?.focus()`);
  await call('Input.insertText', { text: '接电话' });
  await delay(100);
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
  await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
  await delay(400);
  const afterCommitInsert = await evaluate(`(() => ({
    entriesAfterCommit: document.querySelectorAll('#state ol li').length,
    entriesText: [...document.querySelectorAll('#state ol li')].map(li => li.textContent.trim()),
    stateLine: document.querySelector('#state > div')?.textContent?.trim() ?? '',
  }))()`);
  const committedShot = await shot('gallery-explicit-insert-committed.png');

  const summary = {
    detailButtons,
    afterSubtaskComplete,
    afterSubtaskReopen,
    wipeResult,
    entriesBeforeDraft,
    draftState,
    afterCancelDraft,
    afterCommitInsert,
    screenshots: [detailShot, subtaskDoneShot, wipeShot, draftShot, committedShot],
    runtimeErrors,
  };

  await writeFile('evidence/0.3.2-gallery-live-check.json', JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));

  assert.deepEqual(runtimeErrors, []);
  assert.equal(wipeResult.wipeMounts, 1, 'Gallery bag start must mount .wipe exactly once');
  assert.equal(afterSubtaskComplete.doneRows, 1);
  assert.equal(afterSubtaskReopen, 0);
  assert.equal(draftState.hasInput, true);
  assert.equal(draftState.entriesDuringDraft, entriesBeforeDraft, 'Draft must not write an entry before commit');
  assert.equal(afterCancelDraft.hasInput, false);
  assert.equal(afterCancelDraft.entriesAfterCancel, entriesBeforeDraft, 'Canceling draft must not write an entry');
  assert.equal(afterCommitInsert.entriesAfterCommit, entriesBeforeDraft + 1, 'Committing draft must write the insert entry');
} finally {
  ws?.close();
  chrome.kill();
}

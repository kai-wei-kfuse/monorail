// Real React + happy-dom verification for QuickActs UI Option A (immediate tray close, 0ms timer, rapid reopen, accurate at, and failed transaction handling).
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const deadline = setTimeout(() => {
  console.error('TEST_PROCESS_TIMEOUT: quickacts UI reproduction exceeded 60 seconds');
  process.exit(1);
}, 60_000);
deadline.unref();

const { Window } = await import(pathToFileURL(resolve('../原型/测试/node_modules/happy-dom/lib/index.js')).href);
const window = new Window({ url: 'http://localhost/' });
for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'Element', 'Node', 'Event', 'MouseEvent', 'KeyboardEvent', 'FocusEvent']) {
  Object.defineProperty(globalThis, name, { configurable: true, value: name === 'window' ? window : window[name] });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const source = `
import { createElement, act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QuickActs } from './src/app/shell/QuickActs';

const acts = [
  { id: 'act-meal', name: '吃饭', icon: 'meal' },
  { id: 'act-wc', name: '上厕所', icon: 'wc' },
];

export async function verifyQuickActs() {
  const events = [];
  const errors = [];
  let committedCurrent = null;
  let shouldFailTx = false;

  function Host() {
    const [current, setCurrent] = useState(committedCurrent);
    const runTx = (type, payload) => {
      events.push({ type, ...payload });
      if (shouldFailTx) {
        errors.push(\`tx_failed:\${type}\`);
        return;
      }
      if (type === 'pick') {
        committedCurrent = payload.id;
        setCurrent(payload.id);
      }
    };
    return createElement(QuickActs, {
      acts,
      current,
      onPick: (id, at) => runTx('pick', { id, at }),
      onSleep: (at) => runTx('sleep', { at }),
      onTemp: (name, keep, at) => runTx('temp', { name, keep, at }),
    });
  }

  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => { root.render(createElement(Host)); });

  const toggle = () => host.querySelector('.dock-toggle');
  const tray = () => host.querySelector('.tray');

  // 1. Tile click closes immediately (0ms) & rapid reopen is not closed after >650ms
  await act(async () => { toggle().click(); });
  const openBeforeClick = tray() !== null;
  const beforePickMs = Date.now();
  await act(async () => {
    const tiles = [...host.querySelectorAll('.qa')];
    const wcTile = tiles.find(el => el.textContent.includes('上厕所'));
    wcTile.click();
  });
  const afterPickMs = Date.now();
  const closedImmediatelyOnTile = tray() === null && toggle().getAttribute('aria-expanded') === 'false';
  const pickAtMs = Date.parse(events[0]?.at ?? '');
  const pickTimestampAccurate = pickAtMs >= beforePickMs && pickAtMs <= afterPickMs;

  // Rapid reopen immediately and wait 700ms real time to confirm no old 650ms timer closes it
  await act(async () => { toggle().click(); });
  const reopenedImmediately = tray() !== null;
  await new Promise(r => setTimeout(r, 700));
  const stillOpenAfter700ms = tray() !== null && toggle().getAttribute('aria-expanded') === 'true';

  // 2. Digit key '1' closes immediately
  await act(async () => {
    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: '1', bubbles: true, cancelable: true }));
  });
  const closedImmediatelyOnDigit = tray() === null && events[1]?.type === 'pick' && events[1]?.id === 'act-meal';

  // 3. Sleep tile closes immediately
  await act(async () => { toggle().click(); });
  await act(async () => {
    const sleepTile = [...host.querySelectorAll('.qa')].find(el => el.textContent.includes('睡觉'));
    sleepTile.click();
  });
  const closedImmediatelyOnSleep = tray() === null && events[2]?.type === 'sleep' && !Number.isNaN(Date.parse(events[2]?.at));

  // 4. TempRow form submit closes immediately
  await act(async () => { toggle().click(); });
  const tempInput = host.querySelector('input[aria-label="临时活动"]');
  const keepSwitch = host.querySelector('.tray-keep button[role="switch"]');
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(tempInput, '  取快递  ');
    tempInput.dispatchEvent(new window.Event('input', { bubbles: true }));
    keepSwitch.click();
  });
  await act(async () => {
    host.querySelector('form.tray-temp').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  });
  const closedImmediatelyOnTemp = tray() === null && events[3]?.type === 'temp' && events[3]?.name === '取快递' && events[3]?.keep === true;

  // 5. Failed transaction reports error and does not mutate committed current state
  shouldFailTx = true;
  const currentBeforeFailedTx = committedCurrent;
  await act(async () => { toggle().click(); });
  await act(async () => {
    const wcTile = [...host.querySelectorAll('.qa')].find(el => el.textContent.includes('上厕所'));
    wcTile.click();
  });
  const closedOnFailedTx = tray() === null;
  const failedTxReportedWithoutOptimisticState = errors.includes('tx_failed:pick') && committedCurrent === currentBeforeFailedTx;

  await act(async () => { root.unmount(); });
  host.remove();

  return {
    openBeforeClick,
    closedImmediatelyOnTile,
    pickTimestampAccurate,
    reopenedImmediately,
    stillOpenAfter700ms,
    closedImmediatelyOnDigit,
    closedImmediatelyOnSleep,
    closedImmediatelyOnTemp,
    closedOnFailedTx,
    failedTxReportedWithoutOptimisticState,
    eventsCount: events.length,
    errors,
  };
}
`;

const output = await build({
  stdin: { contents: source, resolveDir: process.cwd(), loader: 'tsx' },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  write: false,
  loader: { '.css': 'empty' },
});
const require = createRequire(import.meta.url);
const mod = { exports: {} };
new Function('exports', 'require', 'module', output.outputFiles[0].text)(mod.exports, require, mod);
const result = await mod.exports.verifyQuickActs();
console.log(JSON.stringify(result, null, 2));
const ok = result.openBeforeClick
  && result.closedImmediatelyOnTile
  && result.pickTimestampAccurate
  && result.reopenedImmediately
  && result.stillOpenAfter700ms
  && result.closedImmediatelyOnDigit
  && result.closedImmediatelyOnSleep
  && result.closedImmediatelyOnTemp
  && result.closedOnFailedTx
  && result.failedTxReportedWithoutOptimisticState;
if (!ok) {
  console.error('QUICKACTS_UI_REPRO_FAILED');
  process.exit(1);
}
process.exit(0);

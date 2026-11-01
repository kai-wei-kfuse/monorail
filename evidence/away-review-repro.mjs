// Review reproduction only; uses the prototype's existing happy-dom installation.
// Project policy gives the entire test process a hard 60-second deadline.
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const deadline = setTimeout(() => {
  console.error('TEST_PROCESS_TIMEOUT: review reproduction exceeded 60 seconds');
  process.exit(1);
}, 60_000);
deadline.unref();

const { Window } = await import(pathToFileURL(resolve('../原型/测试/node_modules/happy-dom/lib/index.js')).href);
const window = new Window({ url: 'http://localhost/' });
for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Event', 'MouseEvent', 'FocusEvent']) {
  Object.defineProperty(globalThis, name, { configurable: true, value: name === 'window' ? window : window[name] });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const source = `
import { createElement, act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { useEntry } from './src/pages/home/useEntry';
import { FusedCard } from './src/pages/home/FusedCard';
import { TimerBar } from './src/pages/home/TimerBar';

export async function reproduce() {
  const errors = [], calls = [];
  const actions = Object.fromEntries(['cancelPending','startFree','editOpen','pause','stop','resume','draw','startFavorite','startCard','continueEntry','favorite','createProject','createTag'].map(name => [name, () => {}]));
  // createActions.guard reports failed beginPending and returns undefined, leaving store unchanged.
  actions.beginPending = () => { calls.push('beginPending'); errors.push('injected beginPending transaction failure'); };
  actions.readout = async () => ({ kind: 'done', hit: [] });
  const base = { id: 'base', description: '学 408', project: '学习', tags: ['408'], startedAt: '2026-11-01T09:00:00Z', endedAt: '2026-11-01T09:25:00Z', cardId: null, kind: '普通' };
  const away = { id: 'away', description: '上厕所', project: '生活', tags: [], startedAt: '2026-11-01T09:25:00Z', cardId: null, kind: '插入' };
  const view = { entry: base, away, idle: false, pending: null, paused: null, waitingCard: false, canDraw: true, projects: [], knownTags: [], suggest: { favorites: [], cards: [], recent: [] } };
  const pendingView = { ...view, pending: { id: 'pending', startedAt: '2026-11-01T09:26:00Z' } };
  const look = { topoMode: 'off', topoDepth: 0, paused: false };
  const props = { view: pendingView, actions, card: null, cardView: null, now: Date.parse('2026-11-01T09:27:00Z'), look, titleScale: 65, onManual() {} };
  const buttons = html => {
    const host = document.createElement('div'); host.innerHTML = html;
    return [...host.querySelectorAll('button')].map(button => ({ text: button.textContent, label: button.getAttribute('aria-label'),
      awayDisabled: !!button.closest('fieldset[disabled][title="从临时活动回来后可用"]') }));
  };
  const hasPause = list => list.some(button => button.text.includes('暂停') && button.awayDisabled);
  const hasStop = list => list.some(button => button.label === '停止' && button.awayDisabled);
  const fusedButtons = buttons(renderToStaticMarkup(createElement(FusedCard, props)));
  const splitButtons = buttons(renderToStaticMarkup(createElement(TimerBar, { view: pendingView, actions, mode: 'timer', onMode() {} })));
  let state;
  function Harness() {
    state = useEntry(view, actions);
    return createElement('div', state.groupProps,
      createElement('input', { id: 'review-input', ...state.inputProps }),
      createElement('button', { id: 'review-next', onClick: state.next }, '+'));
  }
  const host = document.createElement('div'); document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => { root.render(createElement(Harness)); });
  const initiallyReadOnly = host.querySelector('input').readOnly;
  await act(async () => {
    host.querySelector('#review-next').click();
    await new Promise(resolve => setTimeout(resolve, 0));
  });
  const result = {
    pendingAndAwayControls: {
      fused: { pause: hasPause(fusedButtons), stop: hasStop(fusedButtons), buttons: fusedButtons },
      split: { pause: hasPause(splitButtons), stop: hasStop(splitButtons), buttons: splitButtons },
    },
    rejectedPendingCreation: {
      initiallyReadOnly, reportedErrors: errors, beginPendingCalls: calls.length,
      committedPending: view.pending, uiDeciding: state.deciding,
      uiFrozen: state.isFrozen, inputReadOnly: host.querySelector('input').readOnly,
    },
  };
  await act(async () => { root.unmount(); });
  host.remove();
  // A keep-draft marker must not suppress ordinary edit-on-blur outside pending.
  result.ordinaryEditBeforeControl = {};
  for (const operation of ['pause', 'stop']) {
    const commandOrder = [];
    const ordinaryView = { ...view, away: null, entry: { ...base, endedAt: null } };
    const ordinaryActions = {
      ...actions,
      editOpen: (id, patch) => commandOrder.push({ command: 'editOpen', id, patch }),
      [operation]: () => commandOrder.push({ command: operation }),
    };
    let ordinaryState;
    function OrdinaryHarness() {
      ordinaryState = useEntry(ordinaryView, ordinaryActions);
      return createElement('section', null,
        createElement('div', ordinaryState.groupProps,
          createElement('input', { id: 'ordinary-input', ...ordinaryState.inputProps })),
        createElement('button', { id: 'ordinary-control', 'data-entry-keep': '', onClick: ordinaryActions[operation] }, operation));
    }
    const ordinaryHost = document.createElement('div'); document.body.appendChild(ordinaryHost);
    const ordinaryRoot = createRoot(ordinaryHost);
    await act(async () => { ordinaryRoot.render(createElement(OrdinaryHarness)); });
    await act(async () => { ordinaryHost.querySelector('input').focus(); });
    // Invoke the public input handler; React itself applies the state update.
    await act(async () => { ordinaryState.inputProps.onChange({ target: { value: '复习 408' } }); });
    await act(async () => {
      ordinaryHost.querySelector('#ordinary-control').focus();
      ordinaryHost.querySelector('#ordinary-control').click();
    });
    result.ordinaryEditBeforeControl[operation] = {
      hasPending: ordinaryView.pending !== null,
      hasAway: !!ordinaryView.away,
      editedInput: ordinaryHost.querySelector('input').value,
      commandOrder,
      editCommittedBeforeControl: commandOrder[0]?.command === 'editOpen'
        && commandOrder[0]?.patch?.description === '复习 408'
        && commandOrder[1]?.command === operation,
    };
    await act(async () => { ordinaryRoot.unmount(); });
    ordinaryHost.remove();
  }
  return result;
}
`;
const output = await build({ stdin: { contents: source, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, platform: 'node', format: 'cjs', write: false, loader: { '.css': 'empty' } });
const module = { exports: {} };
new Function('require', 'module', 'exports', output.outputFiles[0].text)(createRequire(pathToFileURL(resolve('package.json'))), module, module.exports);
const result = await module.exports.reproduce();
console.log(JSON.stringify(result, null, 2));
const controls = Object.values(result.pendingAndAwayControls);
const ghostPending = result.rejectedPendingCreation.uiDeciding && result.rejectedPendingCreation.committedPending === null;
const lostOrdinaryEdit = Object.values(result.ordinaryEditBeforeControl).some(value => !value.editCommittedBeforeControl);
if (controls.some(value => !value.pause || !value.stop) || ghostPending || lostOrdinaryEdit) {
  console.error('REVIEW_REPRO_FAILED: away controls not disabled, ghost pending, or ordinary edit-on-blur suppressed');
  process.exitCode = 1;
}
await window.happyDOM.abort();
clearTimeout(deadline);
// React's DOM scheduler can retain a MessagePort after unmount in this Node harness.
// This one-shot reproduction has finished; return its explicit assertion status.
process.exit(process.exitCode ?? 0);

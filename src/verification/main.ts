import { invoke } from '@tauri-apps/api/core';
import { emit, listen } from '@tauri-apps/api/event';
import { getCurrentWindow, PhysicalPosition, PhysicalSize } from '@tauri-apps/api/window';
import { enable, disable, isEnabled } from '@tauri-apps/plugin-autostart';
import type { Ctx } from '../services/commit';
import type { FileSystem } from '../data/fs';
import type { RecordEntry } from '../domain/record/record';
import { reconcile } from '../services/recordService';
import { start } from '../services/cardService';
import { setMini } from '../platform/windowMode';
import { readLifecycle } from '../platform/lifecycle';
import { appStore } from '../store/appStore';
import { prepareInterruptedJournal } from './journal';

const log = (name: string, data: unknown = null) => invoke('evidence', { message: `${name}:${JSON.stringify(data)}` });
const assert = (test: unknown, message: string) => { if (!test) throw new Error(message); };
async function windowState() {
  const w = getCurrentWindow(), size = await w.innerSize(), position = await w.outerPosition();
  return { width: size.width, height: size.height, x: position.x, y: position.y, max: await w.isMaximized(), top: await w.isAlwaysOnTop(), visible: await w.isVisible(), scale: await w.scaleFactor() };
}
async function windows() {
  const w = getCurrentWindow(), before = await windowState();
  await setMini(true);
  const small = await windowState();
  assert(Math.abs(small.width / small.scale - 520) < 2 && Math.abs(small.height / small.scale - 88) < 2 && small.top, 'Small window size/top mismatch');
  await setMini(false);
  const restored = await windowState();
  assert(restored.width === before.width && restored.height === before.height && restored.x === before.x && restored.y === before.y && restored.top === before.top, 'Window restore mismatch');
  await w.maximize(); await setMini(true); await setMini(false);
  assert(await w.isMaximized(), 'Maximized mode not restored');
  await w.unmaximize(); await w.setSize(new PhysicalSize(before.width, before.height)); await w.setPosition(new PhysicalPosition(before.x, before.y));
  await log('verification-window-passed', { before, small, restored, maximizedRestored: true });
}
async function native() {
  const original = await isEnabled();
  try {
    await enable(); assert(await isEnabled(), 'Autostart enable failed');
    await disable(); assert(!await isEnabled(), 'Autostart disable failed');
    await log('verification-autostart-passed', { original, enabledThenDisabled: true, rebootTested: false });
  } finally { if (original) await enable(); }
  await invoke('simulate_power', { kind: 'suspend' });
  await invoke('simulate_power', { kind: 'resume' });
  const life = await readLifecycle(), resumed = life.events.at(-1), suspended = life.events.at(-2);
  assert(resumed?.simulated && resumed.suspended_at === suspended?.at && resumed.resumed_at === resumed.at, 'Power pair missing');
  await log('verification-power-simulated-passed', { suspended, resumed, realSleepTested: false });
}
async function run(ctx: Ctx) {
  const w = getCurrentWindow();
  await windows(); await native();
  const id = crypto.randomUUID(), cardId = `card-${id}`;
  const record: RecordEntry = { id, text: `Native verification ${id}`, kind: '待办', created_at: new Date().toISOString(),
    due_at: new Date(Date.now() + ctx.settings.deadlineLeadMinutes * 60_000 + 20_000).toISOString(), blocking: true, project_id: null, card_id: null, tags: [], attachments: [] };
  const cardReady = new Promise<void>(resolve => {
    const off = appStore.subscribe(state => { if (state.cards.some(c => c.id === cardId)) { off(); resolve(); } });
  });
  await w.hide(); assert(!await w.isVisible(), 'Main must be hidden before quickbar save');
  await invoke('show_quickbar');
  await log('verification-hidden-record-start', { recordId: id, mainVisible: await w.isVisible() });
  await emit('verification-create-record', record);
  await cardReady;
  await emit('data-changed'); await emit('data-changed');
  await reconcile(ctx);
  const cards = await ctx.repos.cards.list();
  assert(cards.filter(c => c.value.id === cardId).length === 1, 'Duplicate reconciliation');
  await log('verification-hidden-record-passed', { recordId: id, cardId, mainVisible: await w.isVisible(), due: record.due_at });
  const at = new Date().toISOString(); await start(ctx, cardId, at);
  const openDay = (await ctx.repos.state.read()).open_segment_day!;
  const segment = (await ctx.repos.times.readDay(openDay)).find(s => s.ended_at === null);
  assert(segment?.card_id === cardId, 'Verification timer did not start');
  await log('verification-background-start', { at, segmentId: segment!.id, mainVisible: await w.isVisible(), requiredMs: 600_000 });
  await new Promise<void>((resolve, reject) => {
    void listen('main-visible', () => {
      void (async () => {
        const resumedAt = Date.now(), elapsed = resumedAt - Date.parse(at);
        assert(elapsed >= 600_000, `Main was resumed too early: ${elapsed}ms`);
        const actual = (await ctx.repos.times.readDay(openDay)).find(s => s.id === segment!.id);
        assert(actual?.started_at === at && actual.ended_at === null, 'Background segment was modified');
        await log('verification-background-passed', { resumedAt, startedAt: Date.parse(at), elapsedMs: elapsed, segment: actual });
        resolve();
      })().catch(reject);
    });
  });
  await log('verification-complete');
}
export async function install(ctx: Ctx, fs: FileSystem) {
  if (!await invoke<boolean>('verification_enabled')) throw new Error('Verification build required');
  let started = false;
  await listen('verification-start', () => {
    if (started) return;
    started = true;
    void run(ctx).catch(async error => { appStore.setState({ error: String(error) }); await log('verification-failed', String(error)); });
  });
  await listen('verification-journal', () => { void prepareInterruptedJournal(ctx, fs).catch(error => log('verification-journal-unexpected-error', String(error))); });
  await log('verification-ready-main');
}

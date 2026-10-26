import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { tauriFs } from '../data/fs';
import { createRepos } from '../data/repos';
import type { Repositories } from '../data/repos';
import { effective } from '../domain/timeline/effective';
import { nativeReminders } from '../platform/reminders';
import { createContext } from '../services/commit';
import { reconcile } from '../services/recordService';
import { appStore } from '../store/appStore';

export async function restoreRepositories(repos: Repositories, id: () => string, now: () => string) {
  const recovered = await repos.recover();
  const [state, days, settings] = await Promise.all([repos.state.read(), repos.times.scan(), repos.settings.read()]);
  const segments = days.flatMap(day => day.segments);
  if (segments.some(segment => segment.seq > state.max_seq)) throw new Error('state.max_seq 落后于计时记录');
  effective(segments, now());
  const open = days.flatMap(day => day.segments.filter(segment => segment.ended_at === null).map(segment => ({ day: day.day, segment })));
  if (open.length > 1 || (open[0]?.segment.id ?? null) !== state.open_segment) throw new Error('state.yaml: 当前计时段与文件不一致');
  const expectedDay = open[0]?.day ?? null;
  if (state.open_segment_day !== undefined && state.open_segment_day !== expectedDay) throw new Error('state.yaml: 当前计时段日期不一致');
  const writes = [await repos.settings.write(settings)];
  // One-time migration of the original skeleton's state; never scan in a user command.
  if (state.open_segment_day === undefined) writes.push(await repos.state.write({ ...state, open_segment_day: expectedDay }));
  await repos.transact(id(), writes);
  return { recovered, settings };
}

export async function bootstrap(root: string) {
  const fs = await tauriFs(root);
  const repos = createRepos(fs);
  const id = () => crypto.randomUUID(), now = () => new Date().toISOString();
  const restored = await restoreRepositories(repos, id, now);
  const ctx = createContext({
    repos, settings: restored.settings, reminders: nativeReminders, id, now,
    publish: value => appStore.setState({ cards: value.cards, segments: value.segments, currentCard: value.state.current_card, ready: true }),
    log: message => invoke('evidence', { message }),
  });
  const report = (error: unknown) => appStore.setState({ error: String(error) });
  // Register before the initial reconcile; its full record scan covers earlier notifications.
  let booting = true;
  let dirty = false;
  const refresh = () => {
    // Coalesce notifications while the initial reconcile is running.
    if (booting) { dirty = true; return; }
    void reconcile(ctx).catch(report);
  };
  const offChanged = await listen('data-changed', refresh);
  const offVisible = await listen('main-visible', refresh);
  try {
    await ctx.log(`journal-recovered:${restored.recovered}`);
    await reconcile(ctx);
    booting = false;
    if (dirty) await reconcile(ctx);
  } catch (error) { offChanged(); offVisible(); throw error; }
  return { ctx, fs, dispose: () => { offChanged(); offVisible(); } };
}

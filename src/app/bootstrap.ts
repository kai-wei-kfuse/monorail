import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { tauriFs } from '../data/fs';
import { createRepos } from '../data/repos';
import type { Repositories } from '../data/repos';
import { activityDay } from '../domain/timeline/day';
import { nativeLifecycle } from '../platform/lifecycle';
import { nativeReminders } from '../platform/reminders';
import { onQuickbarReady, pushQuickbarContext } from '../platform/quickbarContext';
import { nativeSettingsPlatform } from '../platform/settings';
import { applyPlatform } from '../services/settingsService';
import { inBackpack } from '../domain/task/task';
import type { ReminderPlan } from '../domain/reminders';
import { createContext, run } from '../services/commit';
import { refreshInTx } from '../services/dealService';
import { expireInTx } from '../services/ideaService';
import type { Ctx } from '../services/commit';
import { reconcile } from '../services/recordService';
import { startScheduler } from '../services/scheduler';
import { appStore, publishProjection } from '../store/appStore';
import { appendNotices } from '../store/noticeSlice';

export async function restoreRepositories(repos: Repositories, id: () => string, now: () => string) {
  const recovered = await repos.recover();
  const migration = await repos.migrate(now(), id);
  const [state, settings] = await Promise.all([repos.state.read(), repos.settings.read()]);
  const entries = await repos.times.scan(now(), settings.dayBoundaryHour);
  const open = entries.filter(entry => entry.ended_at === null);
  if (open.length !== 1 || open[0].id !== state.open_entry) throw new Error('state.yaml: 当前计时条目与文件不一致');
  if (state.open_entry_day !== activityDay(open[0].started_at, settings.dayBoundaryHour)) throw new Error('state.yaml: 当前计时条目日期不一致');
  if (state.resume_entry_id && !entries.some(entry => entry.id === state.resume_entry_id)) throw new Error('state.yaml: 回到目标不存在');
  return { recovered, settings, migration };
}

/** The native scheduler delivered a long-activity reminder; surface it as an in-app notice too. */
function notifyLongActivity(ctx: Ctx, plan: ReminderPlan) {
  if (!plan.id.startsWith('long:')) return;
  const open = appStore.getState().entries.find(entry => entry.ended_at === null);
  if (!open) return;
  const notice = { id: plan.id, kind: 'longActivity' as const, data: { activity: open.description, startedAt: open.started_at, hours: ctx.settings.longActivityMinutes / 60 } };
  appStore.setState(previous => ({ notices: appendNotices(previous.notices, [notice]) }));
}

export async function bootstrap(root: string) {
  await invoke('begin_data_migration');
  const fs = await tauriFs(root);
  const repos = createRepos(fs);
  const id = () => crypto.randomUUID(), now = () => new Date().toISOString();
  const restored = await restoreRepositories(repos, id, now);
  const report = (error: unknown) => appStore.setState({ error: String(error) });
  const quickbarContext = async () => pushQuickbarContext({
    tasks: (await repos.tasks.list()).map(e => e.value).filter(inBackpack).map(p => ({ id: p.id, name: p.name })),
    accent: ctx.settings.accent,
  });
  const ctx = createContext({
    repos, settings: restored.settings, reminders: nativeReminders, settingsPlatform: nativeSettingsPlatform, id, now,
    publish: value => { publishProjection(value); void quickbarContext().catch(report); },
    log: message => invoke('evidence', { message }),
  });

  // Register before the initial reconcile; its full record scan covers earlier notifications.
  let booting = true;
  let dirty = false;
  const refresh = () => {
    // Coalesce notifications while the initial reconcile is running.
    if (booting) { dirty = true; return; }
    void reconcile(ctx).catch(report);
  };
  const offs = [await listen('data-changed', refresh), await listen('main-visible', refresh),
    await listen<ReminderPlan>('reminder-fired', event => notifyLongActivity(ctx, event.payload)),
    await onQuickbarReady(() => void quickbarContext().catch(report))];
  const dispose = () => offs.forEach(off => off());
  try {
    await ctx.log(`journal-recovered:${restored.recovered}`);
    await reconcile(ctx);
    booting = false;
    if (dirty) await reconcile(ctx);
    // A new activity day archives stale ideas and re-deals the home card in one transaction; also once at startup.
    const newDay = () => run(ctx, async tx => { expireInTx(tx); refreshInTx(tx); }, ctx.now());
    await newDay();
    offs.push(await startScheduler(ctx, { lifecycle: nativeLifecycle, onDayChanged: newDay, report }));
    // Hotkeys and autostart follow settings.yaml; per-key failures are shown on the settings page.
    const platformErrors = await applyPlatform(ctx);
    await invoke('finish_data_migration');
    return { ctx, fs, dispose, platformErrors };
  } catch (error) { dispose(); throw error; }
}

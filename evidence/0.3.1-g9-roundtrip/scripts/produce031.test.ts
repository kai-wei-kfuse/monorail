// 第 1 步（0.3.1，HEAD 63f7f2c 的 worktree）：用 0.3.1 自己的 service 在真实临时目录写出一份含全部 0.3.1 新数据的数据目录。
// 运行：RT_DATA=<临时数据目录> RT_OUT=<结果 json> vitest run src/rt/produce031.test.ts
import { it, expect } from 'vitest';
import { NodeFs, manifest, writeJson } from './nodeFs';
import { createRepos } from '../data/repos';
import { createContext } from '../services/commit';
import type { Ctx } from '../services/commit';
import { reconcile } from '../services/recordService';
import { newDay } from '../services/dayChange';
import { restoreRepositories } from '../app/bootstrap';
import { card, task } from '../services/serviceFixture';
import * as plan from '../services/planService';
import * as cardService from '../services/cardService';
import * as home from '../services/homeService';
import * as settingsService from '../services/settingsService';
import { list as historyList } from '../services/historyService';
import { activityDay } from '../domain/timeline/day';

const root = process.env.RT_DATA!, out = process.env.RT_OUT!;
const T = (h: number, m = 0) => new Date(2026, 10, 6, h, m).toISOString();

it('0.3.1 produces a data directory with all 0.3.1 artifacts', async () => {
  let now = T(9);
  const fs = new NodeFs(root), repos = createRepos(fs), logs: string[] = [];
  const id = () => crypto.randomUUID();
  const restored = await restoreRepositories(repos, id, () => now);
  const ctx: Ctx = createContext({ repos, settings: restored.settings, reminders: { update: async () => {} }, id, now: () => now,
    publish: () => {}, log: async m => { logs.push(m); } });
  await reconcile(ctx); await newDay(ctx);

  await settingsService.changeLists(ctx, { projects: [{ name: '工作', color: '#20b8ff' }, { name: '学习', color: '#00f5a0' }, { name: '生活', color: '#ff7a1a' }] }, now);
  // 背包里一条任务、两张卡（与 serviceFixture 的 seed 一样直接写，之后全部走 service）
  await repos.transact(id(), await Promise.all([
    repos.tasks.write({ ...task('t-rust'), name: '学 Rust' }, null),
    repos.cards.write(card('c-read', { content: '读第 4 章并做完练习', type: '时间盒卡', timebox_minutes: 60, task_id: 't-rust', project: '学习', order: 1 }), null),
    repos.cards.write(card('c-run', { content: '跑步 5km', task_id: 't-rust', project: '生活', order: 2 }), null),
  ]));
  await plan.add(ctx, 'today', { cardId: 'c-read', priority: '高', todayMinutes: 40 }, now);
  await plan.add(ctx, 'tomorrow', { cardId: 'c-run', priority: '普通' }, now);

  now = T(9, 5); await cardService.start(ctx, 'c-read', now);
  now = T(9, 35);
  const check = await cardService.checkSplit(ctx, 'c-read', now);
  const restMinutes = check.todayGoal === null ? null : check.todayGoal - check.minToday;
  const restId = await cardService.split(ctx, 'c-read', { todayContent: '只读 4.1–4.3', restContent: '4.4 以后和练习', restMinutes }, now);

  now = T(9, 40); await home.insert(ctx, '回同事消息', now, '工作');
  now = T(9, 50); await home.pause(ctx, now);          // 待机 / 插入（闭合的一段）
  now = T(9, 55); await home.continueTimer(ctx, now);  // 插入的事继续
  now = T(10, 0); await home.pause(ctx, now);          // 再暂停：开着的「待机 / 插入」，关应用时停在这里

  now = T(10, 1);
  const changes = [
    await settingsService.change(ctx, 'trackingMode', 'loose', now),
    await settingsService.change(ctx, 'insertBackPlace', 'top', now),
    await settingsService.change(ctx, 'idleAskMinutes', 45, now),
    await settingsService.change(ctx, 'taskMode', false, now),
  ];

  // 重新开一次（新 repos 实例），0.3.1 自己能读
  const reread = await restoreRepositories(createRepos(new NodeFs(root)), id, () => now);
  const state = await repos.state.read(), entries = repos.times.snapshot();
  const day = activityDay(now, reread.settings.dayBoundaryHour);
  const summary = {
    version: '0.3.1 (HEAD 63f7f2c)', now, day, restId, check, restMinutes, changes, logs,
    rest: (await repos.cards.get(restId))!.value, today: (await repos.cards.get('c-read'))!.value,
    planToday: (await repos.plans.read(day)).value, planTomorrow: (await repos.plans.read('2026-11-07')).value,
    state, settings4: { taskMode: reread.settings.taskMode, trackingMode: reread.settings.trackingMode, insertBackPlace: reread.settings.insertBackPlace, idleAskMinutes: reread.settings.idleAskMinutes },
    entries, idleInsert: entries.filter(e => e.project === '待机' && e.kind === '插入'),
    history: (await historyList(ctx, 7, now)).records.map(r => (r as { action?: string }).action),
    manifest: await manifest(root),
  };
  await writeJson(out, summary);
  expect(summary.idleInsert.length).toBe(2);
  expect(summary.idleInsert.some(e => e.ended_at === null)).toBe(true);
  expect((summary.rest as { split_note?: string }).split_note).toBe('读第 4 章并做完练习');
  expect(summary.planToday.items.map(i => i.card_id)).toContain('c-read');
  expect(summary.planTomorrow.items.map(i => i.card_id)).toContain('c-run');
  expect(summary.settings4).toEqual({ taskMode: false, trackingMode: 'loose', insertBackPlace: 'top', idleAskMinutes: 45 });
  expect(Object.keys(summary.manifest).some(p => p.startsWith('.journal/'))).toBe(false);
});

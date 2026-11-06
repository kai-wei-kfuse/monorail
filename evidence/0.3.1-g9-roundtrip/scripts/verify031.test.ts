// 第 3 步（回到 0.3.1）：读旧版写过一次的数据目录，确认 0.3.1 的东西都在、旧版的写入也在，再用 0.3.1 写一笔、重开一次。
// 运行：RT_DATA=<旧版写过的目录> RT_BASE=<第 1 步结果 json>,<第 2 步结果 json> RT_OUT=<结果 json> vitest run src/rt/verify031.test.ts
import { it, expect } from 'vitest';
import { NodeFs, manifest, writeJson, readJson, readText } from './nodeFs';
import { createRepos } from '../data/repos';
import { createContext } from '../services/commit';
import type { Ctx } from '../services/commit';
import { reconcile } from '../services/recordService';
import { newDay } from '../services/dayChange';
import { restoreRepositories } from '../app/bootstrap';
import { cleanup as historyCleanup, list as historyList } from '../services/historyService';
import * as plan from '../services/planService';
import * as home from '../services/homeService';
import type { TimeEntry } from '../domain/timeline/entry';

const root = process.env.RT_DATA!, out = process.env.RT_OUT!;
const [producedPath, oldPath] = process.env.RT_BASE!.split(',');
const T = (h: number, m = 0) => new Date(2026, 10, 6, h, m).toISOString();
type Manifest = Record<string, { sha: string }>;

it('0.3.1 reads the data directory back after the old version wrote to it', async () => {
  const produced = await readJson<{ manifest: Manifest; restId: string; state: Record<string, unknown>; idleInsert: TimeEntry[]; planToday: unknown; planTomorrow: unknown; entries: TimeEntry[] }>(producedPath);
  const old = await readJson<{ version: string; manifest: Manifest }>(oldPath);
  let now = T(11, 30);
  const checks: { name: string; ok: boolean; detail?: unknown }[] = [];
  const check = (name: string, ok: boolean, detail?: unknown) => { checks.push({ name, ok, detail }); };
  const fs = new NodeFs(root), repos = createRepos(fs), logs: string[] = [];
  const id = () => crypto.randomUUID();
  let bootError: string | null = null;
  try {
    const restored = await restoreRepositories(repos, id, () => now);
    check('启动校验 restoreRepositories 通过（journal 恢复 / 迁移 / 计时条目一致）', true, { recovered: restored.recovered, migrated: restored.migration.migrated });
    const ctx: Ctx = createContext({ repos, settings: restored.settings, reminders: { update: async () => {} }, id, now: () => now,
      publish: () => {}, log: async m => { logs.push(m); } });
    await reconcile(ctx); await newDay(ctx);
    const cleaned = await historyCleanup(ctx), page = await historyList(ctx, 7, now);
    check('操作历史可读，无坏记录', page.bad === 0, { count: page.records.length, bad: page.bad, cleaned });

    const before = await manifest(root);
    const plansSame = ['plans/2026-11-06.yaml', 'plans/2026-11-07.yaml'].every(p => before[p]?.sha === produced.manifest[p]?.sha);
    check('plans/ 两个文件与 0.3.1 写出时逐字节相同', plansSame, ['plans/2026-11-06.yaml', 'plans/2026-11-07.yaml'].map(p => [p, produced.manifest[p]?.sha, before[p]?.sha]));
    const today = (await repos.plans.read('2026-11-06')).value, tomorrow = (await repos.plans.read('2026-11-07')).value;
    check('今日任务板读出与第 1 步一致', JSON.stringify(today) === JSON.stringify(produced.planToday), today);
    check('明日任务板读出与第 1 步一致', JSON.stringify(tomorrow) === JSON.stringify(produced.planTomorrow), tomorrow);

    const rest = (await repos.cards.get(produced.restId))!.value as Record<string, unknown>;
    check('拆分卡 split_note 仍在', rest.split_note === '读第 4 章并做完练习', rest.split_note);
    check('拆分卡 shrunk_from / shrink_level 仍在', rest.shrunk_from === 'c-read' && rest.shrink_level === 1, { shrunk_from: rest.shrunk_from, shrink_level: rest.shrink_level });
    check('旧版对拆分卡内容的修改可见', rest.content === '4.4 以后和练习（0.3.0 改）' || rest.content === '4.4 以后和练习（0.2.5 改）', rest.content);
    const original = (await repos.cards.get('c-read'))!.value;
    check('原卡（今天做的）未被改坏', original.content === '只读 4.1–4.3' && original.status === '进行中', { content: original.content, status: original.status });

    const entries = repos.times.snapshot();
    const idle = entries.filter(e => e.project === '待机' && e.kind === '插入');
    check('两条「待机 / 插入」条目原样保留', JSON.stringify(idle) === JSON.stringify(produced.idleInsert), idle.map(e => [e.id, e.started_at, e.ended_at]));
    const lost = produced.entries.filter(p => !entries.some(e => JSON.stringify(e) === JSON.stringify(p)));
    check('第 1 步的全部时间条目都在且未变', lost.length === 0, lost);
    const manual = entries.find(e => e.description.endsWith('补记：晨读'));
    check('旧版补记的时间条目可见', !!manual, manual);

    const state = await repos.state.read();
    check('state.yaml schemaVersion = 2', state.schemaVersion === 2);
    check('state 的 open_entry / resume_entry_id / current_card 与第 1 步一致', state.open_entry === produced.state.open_entry && state.resume_entry_id === produced.state.resume_entry_id && state.current_card === produced.state.current_card,
      { open_entry: state.open_entry, resume_entry_id: state.resume_entry_id, current_card: state.current_card });
    const s = ctx.settings, raw = await readText(root, 'settings.yaml');
    check('settings.yaml schemaVersion = 2', s.schemaVersion === 2 && /^schemaVersion: 2$/m.test(raw));
    const four = { taskMode: s.taskMode, trackingMode: s.trackingMode, insertBackPlace: s.insertBackPlace, idleAskMinutes: s.idleAskMinutes };
    check('四个新设置键保持 0.3.1 写入的非默认值', JSON.stringify(four) === JSON.stringify({ taskMode: false, trackingMode: 'loose', insertBackPlace: 'top', idleAskMinutes: 45 }), four);
    const inFile = ['taskMode: false', 'trackingMode: loose', 'insertBackPlace: top', 'idleAskMinutes: 45'].map(l => [l, new RegExp(`^${l}$`, 'm').test(raw)]);
    check('四个新设置键仍写在 settings.yaml 文件里（不是靠默认值补出来的）', inFile.every(([, ok]) => ok), inFile);
    check('旧版改的设置可见（calendarShowIdle: false）', s.calendarShowIdle === false);
    check('启动时数据目录没有残留 .journal', !Object.keys(before).some(p => p.startsWith('.journal/')));

    // 0.3.1 再写：任务板改量 + 继续暂停的插入（都在旧版写过的文件上走 journal，不应报 External edit）
    now = T(11, 31); await plan.edit(ctx, 'today', { cardId: 'c-read', todayMinutes: 45 } as Parameters<typeof plan.edit>[2], now);
    now = T(11, 32); await home.continueTimer(ctx, now);
    const after = repos.times.snapshot().find(e => e.ended_at === null)!;
    check('0.3.1 写入成功（改任务板量、继续插入），无 External edit', (await repos.plans.read('2026-11-06')).value.items[0].today_minutes === 45 && after.kind === '插入' && after.description === '回同事消息',
      { today_minutes: (await repos.plans.read('2026-11-06')).value.items[0].today_minutes, open: [after.description, after.project, after.kind] });
    await restoreRepositories(createRepos(new NodeFs(root)), id, () => now);
    check('0.3.1 写完后再开一次通过', true);
  } catch (error) {
    bootError = error instanceof Error ? `${error.message}${error.cause ? ` | cause: ${String(error.cause)}` : ''}` : String(error);
    check('未抛错', false, bootError);
  }
  const result = { version: '0.3.1 (HEAD 63f7f2c)', after: old.version, now, checks, logs, bootError, manifest: await manifest(root) };
  await writeJson(out, result);
  for (const c of checks) console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}`);
  expect(checks.filter(c => !c.ok)).toEqual([]);
});

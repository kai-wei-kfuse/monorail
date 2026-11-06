// 第 2 步（0.3.0，tag v0.3.0 的 worktree）：用 0.3.0 自己的代码打开 0.3.1 写出的数据目录，照 0.3.0 bootstrap 的顺序启动，再写几笔。
// 运行：RT_DATA=<拷贝出来的数据目录> RT_OUT=<结果 json> vitest run src/rt/consume030.test.ts
import { it, expect } from 'vitest';
import { NodeFs, manifest, writeJson } from './nodeFs';
import { createRepos } from '../data/repos';
import { createContext, run } from '../services/commit';
import type { Ctx, Snapshot } from '../services/commit';
import { reconcile } from '../services/recordService';
import { refreshInTx } from '../services/dealService';
import { expireInTx } from '../services/ideaService';
import { restoreRepositories } from '../app/bootstrap';
import { cleanup as historyCleanup, list as historyList } from '../services/historyService';
import * as timeEdit from '../services/timeEditService';
import * as cardService from '../services/cardService';
import * as settingsService from '../services/settingsService';

const root = process.env.RT_DATA!, out = process.env.RT_OUT!;
const T = (h: number, m = 0) => new Date(2026, 10, 6, h, m).toISOString();

it('0.3.0 opens the 0.3.1 data directory and writes once', async () => {
  let now = T(11);
  const result: Record<string, unknown> = { version: '0.3.0 (tag v0.3.0)', now };
  const fs = new NodeFs(root), repos = createRepos(fs), logs: string[] = [];
  const id = () => crypto.randomUUID();
  let last: Snapshot | null = null;
  // 照 0.3.0 src/app/bootstrap.ts：recover → migrate → 校验 → createContext → reconcile → 换日（expire + refresh）→ 历史清理
  const restored = await restoreRepositories(repos, id, () => now);
  result.boot = { recovered: restored.recovered, migration: restored.migration };
  const ctx: Ctx = createContext({ repos, settings: restored.settings, reminders: { update: async () => {} }, id, now: () => now,
    publish: s => { last = s; }, log: async m => { logs.push(m); } });
  result.reconcile = await reconcile(ctx);
  await run(ctx, async tx => { expireInTx(tx); refreshInTx(tx); }, ctx.now(), { action: 'system.dayChange', source: { kind: 'system', trigger: 'dayChange' } });
  result.historyCleanup = await historyCleanup(ctx);
  const page = await historyList(ctx, 7, now);
  result.historyBefore = { count: page.records.length, bad: page.bad };
  result.stateAfterBoot = await repos.state.read();
  result.homeAfterBoot = last ? (last as Snapshot).home : null;
  result.writesDuringBoot = [...fs.writes];

  // 0.3.0 读到的 0.3.1 字段
  const rest = (await repos.cards.list()).map(e => e.value).find(c => c.shrunk_from === 'c-read')!;
  result.restAsSeenBy030 = rest;
  result.settingsAsSeenBy030 = Object.fromEntries(['taskMode', 'trackingMode', 'insertBackPlace', 'idleAskMinutes'].map(k => [k, (restored.settings as unknown as Record<string, unknown>)[k]]));
  result.openEntryAsSeenBy030 = repos.times.snapshot().find(e => e.ended_at === null);

  // 0.3.0 写三笔：补一条时间（timelog）、改「剩下的」卡内容（重写 0.3.1 写出的 cards/*.md）、改一个旧设置（重写 settings.yaml）
  fs.writes.length = 0;
  now = T(11, 1);
  result.manualId = await timeEdit.create(ctx, T(7, 0), T(7, 30), now, { description: '0.3.0 补记：晨读', project: '学习', tags: [] });
  now = T(11, 2);
  await cardService.editContent(ctx, rest.id, '4.4 以后和练习（0.3.0 改）', now);
  now = T(11, 3);
  result.settingChange = await settingsService.change(ctx, 'calendarShowIdle', false, now);
  result.writesByOperations = [...fs.writes];

  // 再开一次（新 repos 实例）：0.3.0 仍能读
  const again = await restoreRepositories(createRepos(new NodeFs(root)), id, () => now);
  result.rebootOk = true;
  result.rebootSettings4 = Object.fromEntries(['taskMode', 'trackingMode', 'insertBackPlace', 'idleAskMinutes', 'calendarShowIdle'].map(k => [k, (again.settings as unknown as Record<string, unknown>)[k]]));
  const page2 = await historyList(ctx, 7, now);
  result.historyAfter = { count: page2.records.length, bad: page2.bad };
  result.restAfterEdit = (await createRepos(new NodeFs(root)).cards.get(rest.id))!.value;
  result.logs = logs;
  result.manifest = await manifest(root);
  await writeJson(out, result);
  expect(Object.keys(result.manifest as object).some(p => p.startsWith('.journal/'))).toBe(false);
});

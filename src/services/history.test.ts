// 0.3.0-beta.3 E8a2：历史随业务写进同一份 journal；没有实质改动不写；设置 60 秒内合并；journal 写到一半失败后一起恢复。
import { describe, expect, it, vi } from 'vitest';
import { MemoryFs } from '../data/memoryFs';
import { createRepos } from '../data/repos';
import { HistoryRepo } from '../data/historyRepo';
import { defaults } from '../shared/settings';
import type { HistoryIntent, HistoryRecord } from '../shared/history';
import { createContext, historyMergePath, run, runOperation } from './commit';
import type { Ctx } from './commit';
import { mergeChanges } from './historyCapture';

function fixture() {
  const fs = new MemoryFs();
  let now = new Date(2026, 10, 4, 10).getTime();
  const ctx = createContext({ repos: createRepos(fs), settings: structuredClone(defaults), id: () => crypto.randomUUID(),
    now: () => new Date(now).toISOString(), publish: () => {}, log: async () => {}, reminders: { update: async () => {} } });
  return { fs, ctx, tick: (ms: number) => { now += ms; }, at: () => new Date(now).toISOString() };
}
const manual: HistoryIntent = { action: 'test.direct', source: { kind: 'manual', via: 'main', page: 'settings' } };
const all = async (ctx: Ctx) => (await ctx.repos.history.readDays('2000-01-01', '2999-12-31')).records;
/** 先把待机开出来，再清掉这一条历史，免得它混进后面要数的记录 */
async function warm(f: ReturnType<typeof fixture>) {
  await run(f.ctx, async () => {}, undefined, { action: 'test.direct' });
  await f.ctx.repos.history.removeBefore('2999-12-31', new Set());
}
async function setSetting(f: ReturnType<typeof fixture>, key: keyof typeof defaults, value: unknown, intent = manual) {
  await run(f.ctx, async tx => { await tx.saveSettings({ ...tx.settings, [key]: value }); }, f.at(), intent);
}

describe('execute() 写历史', () => {
  it('有实质改动：业务和历史在同一次提交里落盘；auto 待机作为改动的一部分', async () => {
    const f = fixture();
    await run(f.ctx, async tx => { tx.state.home_mode = 'guide'; }, f.at(), manual);
    const [r] = await all(f.ctx);
    expect(r).toMatchObject({ version: 1, action: 'test.direct', label: '测试直接提交', day: '2026-11-04', source: manual.source });
    expect(r.changes.map(c => [c.type, c.field])).toEqual(expect.arrayContaining([['entry', '描述'], ['state', '首页']]));
  });
  it('没有实质改动、只写回执、命中回执的重放：都不写历史', async () => {
    const f = fixture();
    await warm(f);
    const before = (await f.ctx.repos.history.listAll()).length;
    await run(f.ctx, async () => {}, f.at(), manual);  // 第二次：待机已经在了，没有改动
    const op = { id: crypto.randomUUID(), command: 'save_idea', input: { text: 'x' } };
    await runOperation(f.ctx, op, async () => 'noop', f.at(), undefined, { action: 'test.direct' });   // 只写 receipt
    await runOperation(f.ctx, op, async () => 'noop', f.at(), undefined, { action: 'test.direct' });   // 重放
    expect((await f.ctx.repos.history.listAll()).length).toBe(before);
    expect(before).toBe(0);
  });
  it('自动化调用：没带来源时按「自动化 · 未识别」，附方法、operation_id 和规范化参数', async () => {
    const f = fixture();
    const op = { id: crypto.randomUUID(), command: 'save_idea', input: { text: '想法', b: 1 } };
    await runOperation(f.ctx, op, async tx => { tx.state.home_mode = 'guide'; return 'ok'; }, f.at(), undefined, { action: 'test.direct' });
    const [r] = await all(f.ctx);
    expect(r.source).toEqual({ kind: 'automation', agent: { name: null, detected_by: 'none' } });
    expect(r.call).toEqual({ method: 'save_idea', operation_id: op.id, params: '{"b":1,"text":"想法"}', truncated: false });
  });
});

describe('设置合并（ADR 0019 第 3 条）', () => {
  it('60 秒内同一项同一来源合并成一条：保留首次改前、末次改后，×N', async () => {
    const f = fixture();
    await warm(f);
    await setSetting(f, 'titleScale', 70); f.tick(10_000);
    await setSetting(f, 'titleScale', 80); f.tick(10_000);
    await setSetting(f, 'titleScale', 90);
    const list = await all(f.ctx);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ merged: 3, changes: [{ field: '标题字号', before: String(defaults.titleScale), after: '90' }] });
    expect(historyMergePath(f.ctx)).toBe((await f.ctx.repos.history.listAll())[0]);
  });
  it('全部改回原值：保留这一条，标 reverted；超过 60 秒、换了项目、改日界都另起一条', async () => {
    const f = fixture();
    await warm(f);
    await setSetting(f, 'titleScale', 70); f.tick(5_000);
    await setSetting(f, 'titleScale', defaults.titleScale);
    expect((await all(f.ctx))[0]).toMatchObject({ merged: 2, reverted: true, changes: [] });
    f.tick(61_000); await setSetting(f, 'titleScale', 75);
    await setSetting(f, 'accent', '#20b8ff');
    await setSetting(f, 'dayBoundaryHour', 5); await setSetting(f, 'dayBoundaryHour', 6);
    expect(await all(f.ctx)).toHaveLength(5);
  });
  it('mergeChanges：按对象 + 字段累计，来回的项去掉，只在某次出现的保留', () => {
    const c = (field: string, before: string, after: string) => ({ type: 'settings' as const, id: field, name: field, field, before, after });
    expect(mergeChanges([c('a', '1', '2'), c('b', 'x', 'y')], [c('a', '2', '1'), c('c', 'p', 'q')])).toEqual([c('b', 'x', 'y'), c('c', 'p', 'q')]);
  });
});

describe('journal 写到一半失败', () => {
  it('队列封锁；recover() 后业务和历史一起补完', async () => {
    const f = fixture();
    await warm(f);
    f.fs.beforeWrite = path => { if (path.startsWith('history/')) throw new Error('power loss'); };
    await expect(run(f.ctx, async tx => { tx.state.home_mode = 'guide'; }, f.at(), manual)).rejects.toThrow('power loss');
    await expect(run(f.ctx, async () => {}, f.at(), manual)).rejects.toThrow('提交已阻塞');
    expect(historyMergePath(f.ctx)).toBeNull();
    f.fs.beforeWrite = undefined;
    const repos = createRepos(f.fs);
    expect(await repos.recover()).toBe(1);
    expect((await repos.state.read()).home_mode).toBe('guide');
    expect((await repos.history.readDays('2000-01-01', '2999-12-31')).records).toHaveLength(1);
  });
});

describe('HistoryRepo', () => {
  const rec = (day: string, at: string, id: string = crypto.randomUUID()): HistoryRecord => ({ version: 1, id, at, day, action: 'test.direct', label: 't',
    source: { kind: 'manual', via: 'main' }, subject: null, changes: [], effects: [] });
  it('路径按活动日分目录、文件名是本地时刻；坏文件只计数；按时间从新到旧', async () => {
    const fs = new MemoryFs(), repo = new HistoryRepo(fs);
    const a = rec('2026-11-03', new Date(2026, 10, 3, 9, 5, 7, 8).toISOString(), 'a1'), b = rec('2026-11-04', new Date(2026, 10, 4, 1).toISOString(), 'b1');
    for (const r of [a, b]) { const w = repo.write(r); await fs.atomicWrite(w.path, w.text); }
    expect(repo.pathFor(a)).toBe('history/2026-11-03/090507008-a1.json');
    await fs.atomicWrite('history/2026-11-04/235959999-bad.json', '{not json');
    const read = await repo.readDays('2026-11-01', '2026-11-04');
    expect(read.records.map(r => r.id)).toEqual(['b1', 'a1']);
    expect(read.bad).toBe(1);
    expect((await repo.readDays('2026-11-04', '2026-11-04')).records.map(r => r.id)).toEqual(['b1']);
  });
  it('removeBefore：截止日前的删掉，截止日当天与之后保留，跳过指定路径', async () => {
    const fs = new MemoryFs(), repo = new HistoryRepo(fs);
    const paths = [];
    for (const [d, id] of [['2026-05-07', 'old'], ['2026-05-07', 'keep'], ['2026-05-08', 'edge'], ['2026-11-03', 'new']] as const) {
      const w = repo.write(rec(d, new Date(`${d}T10:00:00`).toISOString(), id)); await fs.atomicWrite(w.path, w.text); paths.push(w.path);
    }
    expect(await repo.removeBefore('2026-05-08', new Set([paths[1]]))).toEqual({ removed: 1, failed: 0 });
    expect((await repo.listAll()).map(p => p.split('-').at(-1))).toEqual(['keep.json', 'edge.json', 'new.json']);
  });
});

vi.setConfig({ testTimeout: 10_000 });

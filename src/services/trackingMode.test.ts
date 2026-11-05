import { describe, expect, it } from 'vitest';
import { at, card, fixture, getCard, open, entries, seed } from './serviceFixture';
import type { Fixture } from './serviceFixture';
import { start } from './cardService';
import { answerIdle, insert, pause, resume, settleOffline, startFree } from './homeService';
import { planReminders } from '../domain/reminders';
import type { Notice } from '../shared/notices';

// 宽松 / 紧凑计时模式（ADR 0021 第 13 条，执行方案 G6b，已定 58、59）。两种模式存的数据一样，只改显示和追问。
const loose = (f: Fixture) => { f.ctx.settings = { ...f.ctx.settings, trackingMode: 'loose' }; };
const notices = (f: Fixture) => f.publish.mock.calls.at(-1)![0].notices;
const home = (f: Fixture) => f.publish.mock.calls.at(-1)![0].home;
/** 最近一次提交推出的空闲追问 */
const idleAsk = (f: Fixture) => (notices(f) as Notice[]).find((n): n is Notice<'idleAsk'> => n.kind === 'idleAsk');

describe('关机、休眠后的离线结算', () => {
  it('紧凑：记成离线并追问（不变）', async () => {
    const f = fixture(); await seed(f, []);
    f.clock(at(30)); await settleOffline(f.ctx, { start: at(10), end: at(30) });
    expect(entries(f).find(e => e.source === '离线追问')).toMatchObject({ project: '离线' });
    expect(notices(f).some((n: { kind: string }) => n.kind === 'offlineAsk')).toBe(true);
  });
  it('宽松：记成待机、不追问；重复结算只记一次（去重照旧靠 source 离线追问，第 3 轮 S3）', async () => {
    const f = fixture(); await seed(f, []); loose(f);
    f.clock(at(30)); await settleOffline(f.ctx, { start: at(10), end: at(30) });
    expect(notices(f).some((n: { kind: string }) => n.kind === 'offlineAsk')).toBe(false);
    await settleOffline(f.ctx, { start: at(10), end: at(30) });
    expect(entries(f).filter(e => e.source === '离线追问')).toEqual([expect.objectContaining({ project: '待机', started_at: at(10), ended_at: at(30) })]);
  });
});

describe('空闲追问（紧凑模式）', () => {
  it('待机超过阈值后开始下一件事：问一次；回答把那段改成这项、kind 改成普通', async () => {
    const f = fixture(); await seed(f, []); f.ctx.settings = { ...f.ctx.settings, idleAskMinutes: 30 };
    f.clock(at(31)); await startFree(f.ctx, { description: '写周报', project: '工作', tags: [] }, at(31));
    const ask = idleAsk(f)!;
    expect(ask.data).toMatchObject({ from: at(), to: at(31), minutes: 31 });
    f.clock(at(32)); await answerIdle(f.ctx, ask.data.entryId, '吃早饭', at(32));
    expect(entries(f).find(e => e.id === ask.data.entryId)).toMatchObject({ description: '吃早饭', kind: '普通', ended_at: at(31) });
  });
  it('刚好等于阈值、短于阈值：不问；宽松模式：不问', async () => {
    for (const [minute, mode] of [[30, 'strict'], [10, 'strict'], [60, 'loose']] as const) {
      const f = fixture(); await seed(f, []); f.ctx.settings = { ...f.ctx.settings, idleAskMinutes: 30, trackingMode: mode };
      f.clock(at(minute)); await startFree(f.ctx, { description: '写周报', project: '工作', tags: [] }, at(minute));
      expect(notices(f).some((n: { kind: string }) => n.kind === 'idleAsk')).toBe(false);
    }
  });
  it('卡暂停那段回答后：kind 从暂停改成普通，不留下「学习 / 暂停」', async () => {
    const f = fixture(); await seed(f, [card('a')]); f.ctx.settings = { ...f.ctx.settings, idleAskMinutes: 5 };
    await start(f.ctx, 'a', at()); f.clock(at(2)); await pause(f.ctx, at(2));
    const paused = open(f);
    f.clock(at(20)); await resume(f.ctx, at(20));
    const ask = idleAsk(f)!;
    expect(ask.data.entryId).toBe(paused.id);
    f.clock(at(21)); await answerIdle(f.ctx, paused.id, '接电话', at(21));
    expect(entries(f).find(e => e.id === paused.id)).toMatchObject({ description: '接电话', kind: '普通' });
    expect((await getCard(f, 'a')).status).toBe('进行中');
  });
});

describe('显示', () => {
  it('宽松模式的「没在计时」只在真正什么都没在做时为真（第 3 轮 S5）', async () => {
    const f = fixture(); await seed(f, [card('a')]); loose(f);
    f.clock(at(1)); await startFree(f.ctx, { description: 'x', project: '工作', tags: [] }, at(1));
    expect(home(f).looseIdle).toBe(false);
    f.clock(at(2)); await pause(f.ctx, at(2));
    expect(home(f).looseIdle).toBe(false);          // 暂停中有回到目标
    f.clock(at(3)); await start(f.ctx, 'a', at(3)); f.clock(at(4)); await insert(f.ctx, 'wc', at(4)); f.clock(at(5)); await pause(f.ctx, at(5));
    expect(home(f).looseIdle).toBe(false);          // 插入的事暂停
    const g = fixture(); await seed(g, []); loose(g); g.clock(at(1)); await startFree(g.ctx, { description: 'x', project: '工作', tags: [] }, at(1));
    const { stop } = await import('./homeService'); g.clock(at(2)); await stop(g.ctx, at(2));
    expect(home(g).looseIdle).toBe(true);
  });
  it('长时间提醒：宽松模式下开着的是待机时不排（第 3 轮 S4）', () => {
    const idle = { id: 'i', started_at: at(), ended_at: null, description: '待机', project: '待机', tags: [], card_id: null, kind: '普通' as const, source: '自动' as const, updated_at: at() };
    const base = { cards: [], open: idle, deadlineLeadMinutes: 60, longActivityMinutes: 240 };
    expect(planReminders({ ...base, loose: true }).some(p => p.id.startsWith('long:'))).toBe(false);
    expect(planReminders({ ...base, loose: false }).some(p => p.id.startsWith('long:'))).toBe(true);
  });
});

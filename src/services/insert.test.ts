import { describe, expect, it } from 'vitest';
import { at, card, fixture, getCard, open, entries, seed } from './serviceFixture';
import type { Fixture } from './serviceFixture';
import { start } from './cardService';
import { beginPending, commitReadout, continueEntry, continueTimer, dispatchMiniCommand, editOpen, endOriginal, insert, pause, resume, rest, startCard, startFree, startPreset, stop } from './homeService';
import { canContinueInsert } from './tracking/api';
import type { MiniCommand } from '../platform/windowBus';
import { projectMini } from './miniProjection';

// 插入（ADR 0021 第 3 条，执行方案 G4）
async function working() {
  const f = fixture();
  f.ctx.settings.lists.presets = [
    { id: 'wc', name: '厕所', project: '生活', tags: [], mode: '切换', place: '弹层' },          // 快捷活动：mode 不再读
    { id: 'mail', name: '回邮件', project: '工作', tags: [], mode: '插入', place: '计时条' },     // 收藏
  ];
  await seed(f, [card('c1', { content: '读第 4 章' }), card('c2', { content: '跑步', order: 2 })]);
  await start(f.ctx, 'c1', at());
  return f;
}
const state = (f: Fixture) => f.ctx.repos.state.read();
const mini = async (f: Fixture, type: 'pause' | 'resume' | 'backToTask', at_: string) => {
  const s = await state(f);
  return dispatchMiniCommand(f.ctx, { type, requestId: crypto.randomUUID(), at: at_, entryId: s.open_entry, cardId: s.current_card, epoch: 0 } as MiniCommand);
};

describe('做卡时开始别的事都是插入', () => {
  it.each([
    ['快捷活动（mode 写着切换也插入）', (f: Fixture) => startPreset(f.ctx, 'wc', at(10))],
    ['收藏', (f: Fixture) => startPreset(f.ctx, 'mail', at(10))],
    ['计时框写新事件', (f: Fixture) => startFree(f.ctx, { description: '接电话', project: '工作', tags: [] }, at(10))],
    ['临时活动', (f: Fixture) => insert(f.ctx, '拿快递', at(10))],
  ] as const)('%s：卡保持进行中，回到目标是卡', async (_, act) => {
    const f = await working(); f.clock(at(10)); await act(f);
    expect(open(f)).toMatchObject({ kind: '插入', card_id: null, started_at: at(10) });
    expect((await getCard(f, 'c1')).status).toBe('进行中');
    const resumeId = (await state(f)).resume_entry_id;
    expect(entries(f).find(e => e.id === resumeId)).toMatchObject({ card_id: 'c1', ended_at: at(10) });
  });

  it('待确认起点（往前拨过）不丢，待确认清掉（第 2 轮 B3）', async () => {
    const f = await working();
    f.clock(at(10)); await beginPending(f.ctx, at(10));
    const pid = (await state(f)).pending_id!;
    await commitReadout(f.ctx, { target: { mode: 'pending', id: pid }, at: at(10), milliseconds: 4 * 60000 }, null);
    f.clock(at(12)); await startFree(f.ctx, { description: '接电话', project: '工作', tags: [] }, at(12));
    expect(open(f)).toMatchObject({ kind: '插入', started_at: at(6) });
    expect(await state(f)).toMatchObject({ pending_id: null, pending_at: null });
  });

  it('卡暂停中再开始别的事也是插入，原来那张照样等着', async () => {
    const f = await working(); f.clock(at(5)); await pause(f.ctx, at(5));
    f.clock(at(8)); await startFree(f.ctx, { description: '接电话', project: '工作', tags: [] }, at(8));
    expect(open(f)).toMatchObject({ kind: '插入', description: '接电话' });
    expect((await getCard(f, 'c1')).status).toBe('进行中');
  });

  it('插入中再开始别的事：替换插入的事，回到目标不变', async () => {
    const f = await working(); f.clock(at(10)); await startPreset(f.ctx, 'wc', at(10));
    const target = (await state(f)).resume_entry_id;
    f.clock(at(15)); await startFree(f.ctx, { description: '回同事消息', project: '工作', tags: [] }, at(15));
    expect(open(f)).toMatchObject({ kind: '插入', description: '回同事消息' });
    expect((await state(f)).resume_entry_id).toBe(target);
  });

  it('插入中不能开始另一张卡（已定 20）；继续原来那张卡的条目 = 回到任务', async () => {
    const f = await working(); f.clock(at(10)); await startPreset(f.ctx, 'wc', at(10));
    await expect(startCard(f.ctx, 'c2', at(11))).rejects.toThrow('IN_AWAY_ACTIVITY');
    const cardEntryId = entries(f).find(e => e.card_id === 'c1')!.id;
    f.clock(at(12)); await continueEntry(f.ctx, cardEntryId, at(12));
    expect(open(f)).toMatchObject({ card_id: 'c1', kind: '普通', started_at: at(12) });
    expect((await state(f)).resume_entry_id).toBeNull();
  });

  it('自由计时时：快捷活动插入，计时框写新事件照常切换', async () => {
    const f = fixture(); await seed(f, []);
    f.clock(at(1)); await startFree(f.ctx, { description: '写周报', project: '工作', tags: [] }, at(1));
    f.clock(at(5)); await insert(f.ctx, 'wc', at(5));
    expect(open(f)).toMatchObject({ kind: '插入' });
    f.clock(at(8)); await resume(f.ctx, at(8));
    expect(open(f)).toMatchObject({ description: '写周报', kind: '普通' });
    f.clock(at(10)); await startFree(f.ctx, { description: '开会', project: '工作', tags: [] }, at(10));
    expect(open(f)).toMatchObject({ description: '开会', kind: '普通' });
    expect((await state(f)).resume_entry_id).toBeNull();
  });
});

describe('插入的事暂停 / 继续、回到任务、结束原任务（已定 19、26、56、57；第 3 轮 B1）', () => {
  it.each(['首页', '小窗'] as const)('%s 的暂停 / 继续：暂停是插入的事暂停（待机 / 插入），继续接着插入的事', async via => {
    const f = await working(); f.clock(at(10)); await startPreset(f.ctx, 'wc', at(10));
    const target = (await state(f)).resume_entry_id;
    f.clock(at(14)); if (via === '首页') await pause(f.ctx, at(14)); else await mini(f, 'pause', at(14));
    expect(open(f)).toMatchObject({ project: '待机', kind: '插入' });
    expect((await state(f)).resume_entry_id).toBe(target);
    expect(canContinueInsert(entries(f), open(f), entries(f).find(e => e.id === target))).toBe(true);
    f.clock(at(18)); if (via === '首页') await continueTimer(f.ctx, at(18)); else await mini(f, 'resume', at(18));
    expect(open(f)).toMatchObject({ description: '厕所', kind: '插入', started_at: at(18) });
    expect((await state(f)).resume_entry_id).toBe(target);
  });

  it('插入的事暂停时再点暂停什么都不做；插入状态下不能停止', async () => {
    const f = await working(); f.clock(at(10)); await startPreset(f.ctx, 'wc', at(10));
    f.clock(at(14)); await pause(f.ctx, at(14));
    const before = open(f);
    f.clock(at(15)); await pause(f.ctx, at(15));
    expect(open(f)).toEqual(before);
    await expect(stop(f.ctx, at(16))).rejects.toThrow('IN_AWAY_ACTIVITY');
  });

  it('〔回到任务〕（含小窗 backToTask）：卡接着计，插入的时间不算进卡', async () => {
    const f = await working(); f.clock(at(10)); await startPreset(f.ctx, 'wc', at(10));
    f.clock(at(14)); await pause(f.ctx, at(14));
    f.clock(at(20)); await mini(f, 'backToTask', at(20));
    expect(open(f)).toMatchObject({ card_id: 'c1', kind: '普通', started_at: at(20) });
    expect((await state(f)).resume_entry_id).toBeNull();
  });

  it('结束原任务：插入的事变成普通自由记录接着计，原来那张回待做', async () => {
    const f = await working(); f.clock(at(10)); await startFree(f.ctx, { description: '接电话', project: '工作', tags: [] }, at(10));
    const insertId = open(f).id;
    f.clock(at(15)); await endOriginal(f.ctx, at(15));
    expect(open(f)).toMatchObject({ id: insertId, description: '接电话', kind: '普通', started_at: at(10) });
    expect((await state(f)).resume_entry_id).toBeNull();
    expect((await getCard(f, 'c1')).status).toBe('待做');
  });

  it('结束原任务也适用于插入的事暂停时：那段待机变成普通待机', async () => {
    const f = await working(); f.clock(at(10)); await startPreset(f.ctx, 'wc', at(10));
    f.clock(at(14)); await pause(f.ctx, at(14));
    f.clock(at(16)); await endOriginal(f.ctx, at(16));
    expect(open(f)).toMatchObject({ project: '待机', kind: '普通' });
    expect((await getCard(f, 'c1')).status).toBe('待做');
  });

  it('主动休息（已定 48、55）：插入一条「休息」，回来就是回到任务', async () => {
    const f = await working(); f.clock(at(10)); await rest(f.ctx, at(10));
    expect(open(f)).toMatchObject({ description: '休息', project: '休息', kind: '插入' });
    expect((await state(f)).rest).toBeNull();
    f.clock(at(20)); await resume(f.ctx, at(20));
    expect(open(f)).toMatchObject({ card_id: 'c1', kind: '普通' });
  });
  it('〔休息一下〕可以换项目（已定 63）：选用户项目就记到它，系统项目只认「休息」', async () => {
    const f = await working(); f.ctx.settings = { ...f.ctx.settings, lists: { ...f.ctx.settings.lists, projects: [{ name: '学习', color: '#1aa3ff' }] } };
    f.clock(at(10)); await rest(f.ctx, at(10), '学习');
    expect(open(f)).toMatchObject({ description: '休息', project: '学习', kind: '插入' });
    f.clock(at(12)); await resume(f.ctx, at(12));
    await expect(rest(f.ctx, at(12), '待机')).rejects.toThrow('RESERVED_PROJECT');
  });
});

describe('小窗的插入状态（执行方案 G7）', () => {
  const snap = (f: Fixture) => projectMini(f.publish.mock.calls.at(-1)![0], 0);
  it('插入中：带上原来那张的名字；插入的事暂停：paused、能继续；回到任务后为 null', async () => {
    const f = await working(); f.clock(at(10)); await insert(f.ctx, 'wc', at(10));
    expect(snap(f).inserting).toEqual({ originalTitle: '读第 4 章', name: '厕所', paused: false, canContinue: false, closedMs: 0 });
    f.clock(at(12)); await mini(f, 'pause', at(12));
    expect(snap(f).inserting).toEqual({ originalTitle: '读第 4 章', name: '厕所', paused: true, canContinue: true, closedMs: 2 * 60_000 });
    f.clock(at(14)); await mini(f, 'backToTask', at(14));
    expect(snap(f).inserting).toBeNull();
    expect(open(f)).toMatchObject({ card_id: 'c1', kind: '普通' });
  });
});

describe('插入卡的投影 home.insert（UI 规范 §11.14）', () => {
  const home = (f: Awaited<ReturnType<typeof working>>) => f.publish.mock.calls.at(-1)![0].home;
  it('插入中：插的事、被插的卡和今天已计；插入的事暂停后能继续；回到任务后为 null', async () => {
    const f = await working(); f.clock(at(10)); await insert(f.ctx, 'wc', at(10));
    expect(home(f).insert).toMatchObject({ paused: false, name: '厕所', project: '生活', startedAt: at(10),
      over: { kind: 'card', cardId: 'c1', todayMs: 10 * 60_000 } });
    f.clock(at(12)); await pause(f.ctx, at(12));
    expect(home(f).insert).toMatchObject({ paused: true, canContinue: true, name: '厕所', startedAt: null });
    f.clock(at(14)); await resume(f.ctx, at(14));
    expect(home(f).insert).toBeNull();
  });
  it('暂停不重置读数（用户 2026-11-06）：closedMs 是这件事前面几段之和；继续后接着加；换成别的事从 0 算；记录照旧分段', async () => {
    const f = await working(); f.clock(at(10)); await insert(f.ctx, 'wc', at(10));
    expect(home(f).insert).toMatchObject({ closedMs: 0, startedAt: at(10) });
    f.clock(at(12)); await pause(f.ctx, at(12));
    expect(home(f).insert).toMatchObject({ paused: true, closedMs: 2 * 60_000, startedAt: null });
    f.clock(at(15)); await continueTimer(f.ctx, at(15));
    expect(home(f).insert).toMatchObject({ paused: false, name: '厕所', closedMs: 2 * 60_000, startedAt: at(15) });
    f.clock(at(16)); await pause(f.ctx, at(16));
    expect(home(f).insert).toMatchObject({ paused: true, closedMs: 3 * 60_000 });
    f.clock(at(17)); await continueTimer(f.ctx, at(17));
    expect(home(f).insert).toMatchObject({ closedMs: 3 * 60_000, startedAt: at(17) });
    expect(entries(f).filter(e => e.kind === '插入' && e.project === '生活').length).toBe(3);
    f.clock(at(18)); await startFree(f.ctx, { description: '回消息', project: '工作', tags: [] }, at(18));
    expect(home(f).insert).toMatchObject({ name: '回消息', closedMs: 0, startedAt: at(18) });
  });
});

describe('插入累计读数的编辑（G7 收尾审核 P2-1、P2-2）', () => {
  const home = (f: Fixture) => f.publish.mock.calls.at(-1)![0].home;
  // 10 分插入「厕所」，12 分暂停，15 分继续，16 分时累计 3 分（前段 2 + 当前 1）
  async function resumedInsert() {
    const f = await working(); f.clock(at(10)); await insert(f.ctx, 'wc', at(10));
    f.clock(at(12)); await pause(f.ctx, at(12));
    f.clock(at(15)); await continueTimer(f.ctx, at(15));
    f.clock(at(16));
    return f;
  }
  const shown = (f: Fixture) => { const i = home(f).insert!; return i.closedMs + Date.parse(at(16)) - Date.parse(i.startedAt!); };
  const setMini = (f: Fixture, mode: 'insertRun' | 'entry', ms: number) => {
    const s = projectMini(f.publish.mock.calls.at(-1)![0], 0);
    return dispatchMiniCommand(f.ctx, { type: 'setReadout', requestId: crypto.randomUUID(), at: at(16), epoch: 0, entryId: s.entryId, cardId: s.cardId,
      revision: s.revision, pending_id: s.pending_id, target: { mode, id: s.entry!.id }, milliseconds: ms, seen: null } as MiniCommand);
  };
  it('小窗改累计读数（insertRun）：写 4 分就是 4 分，只挪开着这一段的起点，前面那段不动', async () => {
    const f = await resumedInsert();
    expect(shown(f)).toBe(3 * 60_000);
    expect((await setMini(f, 'insertRun', 4 * 60_000)).kind).toBe('done');
    expect(shown(f)).toBe(4 * 60_000);
    expect(open(f).started_at).toBe(at(14));
    expect(entries(f).find(e => e.kind === '插入' && e.started_at === at(10))).toMatchObject({ ended_at: at(12) });
  });
  it('累计读数写得比前面几段还少：拒绝，提示去日历改', async () => {
    const f = await resumedInsert();
    await expect(setMini(f, 'insertRun', 60_000)).rejects.toThrow('最少 2 分钟');
    expect(shown(f)).toBe(3 * 60_000);
  });
  it.each([{ description: '厕所（改名）' }, { project: '工作' }])('改名 / 改项目 = 整件事一起改，累计不丢：%j', async patch => {
    const f = await resumedInsert();
    const cardBefore = entries(f).find(e => e.card_id === 'c1')!;
    await editOpen(f.ctx, open(f).id, patch, at(16));
    expect(home(f).insert!.closedMs).toBe(2 * 60_000);
    expect(shown(f)).toBe(3 * 60_000);
    const segs = entries(f).filter(e => e.kind === '插入' && e.project !== '待机');
    expect(segs).toHaveLength(2);
    for (const s of segs) expect(s).toMatchObject(patch);
    // 原来那张卡的记录不受影响
    expect(entries(f).find(e => e.card_id === 'c1')).toMatchObject({ description: cardBefore.description, project: cardBefore.project });
  });
});

describe('卡暂停中「继续这一条」继续的正是原来那张卡（代码审核 S5）', () => {
  it('等于〔继续〕：从点的那一刻接着计，回到目标清掉', async () => {
    const f = await working(); f.clock(at(5)); await pause(f.ctx, at(5));
    const cardEntryId = entries(f).find(e => e.card_id === 'c1')!.id;
    f.clock(at(9)); await continueEntry(f.ctx, cardEntryId, at(9));
    expect(open(f)).toMatchObject({ card_id: 'c1', kind: '普通', started_at: at(9) });
    expect((await state(f)).resume_entry_id).toBeNull();
  });
  it('插入中开始原来那张卡（背包里点开始）= 回到任务；开始别的卡拒绝', async () => {
    const f = await working(); f.clock(at(10)); await startPreset(f.ctx, 'wc', at(10));
    await expect(startCard(f.ctx, 'c2', at(11))).rejects.toThrow('IN_AWAY_ACTIVITY');
    f.clock(at(12)); await startCard(f.ctx, 'c1', at(12));
    expect(open(f)).toMatchObject({ card_id: 'c1', kind: '普通', started_at: at(12) });
    expect((await state(f)).resume_entry_id).toBeNull();
  });
});

describe('任务模式关掉（G7 审核 S3）', () => {
  it('「继续这一条」遇到卡的条目：退成自由记录，不开始卡；自动完成不列卡', async () => {
    const f = await working(); f.clock(at(5)); await stop(f.ctx, at(5));
    const cardEntry = entries(f).find(e => e.card_id === 'c1')!;
    f.ctx.settings = { ...f.ctx.settings, taskMode: false };
    f.clock(at(6)); await continueEntry(f.ctx, cardEntry.id, at(6));
    expect(open(f)).toMatchObject({ card_id: null, description: cardEntry.description });
    expect((await getCard(f, 'c1')).status).toBe('待做');
    const { suggestSource } = await import('./suggestSource');
    expect(suggestSource({ presets: [], cards: [{ id: 'c2', content: '跑步', status: '待做', task_id: null }], tasks: [], entries: [], taskMode: false }).cards).toEqual([]);
  });
});

import { expect, it, vi } from 'vitest';
import { fixture, card, project, seed, at, open, getCard } from './serviceFixture';
import type { Fixture } from './serviceFixture';
import { createContext, run } from './commit';
import { freezeProject } from './backpackService';
import { enter, goto, addIdea, duel, takeCold, skipCold, continueBet, switchMain, finish } from './reviewService';
import { refresh } from './dealService';
import { start, redraw } from './cardService';
import { insert } from './timerService';
import { createRecord } from '../domain/record/record';
import { activityDay } from '../domain/timeline/day';
import type { Segment } from '../domain/timeline/segment';

const view = (f: Fixture) => f.publish.mock.calls.at(-1)![0].review!;
const saved = async (f: Fixture) => (await f.ctx.repos.reviews.list()).map(row => row.value);
async function toCold(f: Fixture) {
  await enter(f.ctx, f.ctx.now());
  await goto(f.ctx, 'newIdeas', f.ctx.now()); await goto(f.ctx, 'arena', f.ctx.now()); await goto(f.ctx, 'coldPick', f.ctx.now());
}
async function ideas(f: Fixture, count: number, cold = 0) {
  const entries = Array.from({ length: count + cold }, (_, i) => {
    const idea = createRecord({ id: crypto.randomUUID(), text: `idea-${i}`, kind: '想法', created_at: at(i),
      due_at: null, blocking: false, project_id: null, card_id: null, tags: [], attachments: [] });
    return i < count ? idea : { ...idea, pool: '冷库' as const, cold_since: at(i) };
  });
  await f.ctx.repos.transact(crypto.randomUUID(), await Promise.all(entries.map(value => f.ctx.repos.records.write(value, null))));
  return entries;
}

it('A8 active first-week review completes the ISO period and does not enter the daily baseline', async () => {
  const f = fixture(); await toCold(f);
  expect(view(f).period).toBe('2026-W44');
  f.clock(at(10)); await finish(f.ctx, at(10));
  expect((await saved(f))[0]).toMatchObject({ status: '已完成', completed_at: at(10), done: ['recap', 'newIdeas', 'arena', 'coldPick'] });
  expect(open(f).category).toBe('待机'); expect(f.home().baseline).toMatchObject({ main: null, side: false });
  f.clock(new Date(2026, 10, 1, 12).toISOString()); await refresh(f.ctx, f.ctx.now());
  expect(f.home().review).toBeNull();
  const seq = (await f.ctx.repos.state.read()).max_seq;
  await enter(f.ctx, f.ctx.now()); expect((await f.ctx.repos.state.read()).max_seq).toBe(seq);
});

it('A8 persisted step and completed prefix survive a fresh context; completed steps can be revisited', async () => {
  const f = fixture(); await enter(f.ctx, at()); await goto(f.ctx, 'newIdeas', at());
  await addIdea(f.ctx, 'restart idea', at()); await goto(f.ctx, 'arena', at());
  const ctx = createContext({ ...f.ctx, settings: await f.ctx.repos.settings.read() });
  await enter(ctx, at(1));
  expect(view(f)).toMatchObject({ step: 'arena', done: ['recap', 'newIdeas'], addedIdeas: ['restart idea'] });
  expect((await f.ctx.repos.state.read()).max_seq).toBe(1);
  await goto(ctx, 'recap', at(1)); await goto(ctx, 'newIdeas', at(1)); await goto(ctx, 'arena', at(1));
  expect(view(f).step).toBe('arena');
});

it('A8 navigation cannot skip future steps or finish before their completion', async () => {
  const f = fixture(); await enter(f.ctx, at());
  await expect(goto(f.ctx, 'coldPick', at())).rejects.toThrow('前面');
  await expect(finish(f.ctx, at())).rejects.toThrow('全部');
  expect(view(f).step).toBe('recap');
});

it('A8 page refresh and hiding-equivalent idle time do not end review; quick activity and another card do', async () => {
  const f = fixture(); await seed(f, [card('a')]); await start(f.ctx, 'a', at());
  f.clock(at(1)); await enter(f.ctx, at(1)); expect((await getCard(f, 'a')).status).toBe('待做');
  const id = open(f).id; f.clock(at(5)); await refresh(f.ctx, at(5)); expect(open(f).id).toBe(id);
  f.clock(at(6)); await insert(f.ctx, 'wc', at(6)); expect(open(f).category).toBe('生活');
  f.clock(at(7)); await enter(f.ctx, at(7)); expect(open(f).category).toBe('回顾');
  f.clock(at(8)); await start(f.ctx, 'a', at(8)); expect(open(f).card_id).toBe('a');
  expect((await saved(f))[0].status).toBe('进行中');
});

it('finishing after a quick activity does not end that unrelated activity', async () => {
  const f = fixture(); await toCold(f); f.clock(at(1)); await insert(f.ctx, 'wc', at(1));
  const id = open(f).id; await finish(f.ctx, at(2)); expect(open(f).id).toBe(id);
});

it('an identically named custom review activity is not mistaken for this review timer', async () => {
  const f = fixture(); f.ctx.settings.lists.quickActivities = [{ id: 'custom', name: '每周回顾', category: '回顾' }];
  await toCold(f); f.clock(at(1)); await insert(f.ctx, 'custom', at(1));
  const id = open(f).id; await finish(f.ctx, at(1)); expect(open(f).id).toBe(id);
});

it('A8 the due weekday starts exactly at the configured activity boundary', async () => {
  const f = fixture(); await seed(f, []); await refresh(f.ctx, f.ctx.now());
  f.clock(new Date(2026, 10, 8, 3, 59).toISOString()); await refresh(f.ctx, f.ctx.now()); expect(f.home().review).toBeNull();
  f.clock(new Date(2026, 10, 8, 4, 0).toISOString()); await refresh(f.ctx, f.ctx.now()); expect(f.home().review?.period).toBe('2026-W45');
  await enter(f.ctx, f.ctx.now()); expect(view(f).step).toBe('recap');
});

it('new ideas persist and arena cannot advance until every excess idea is resolved', async () => {
  const f = fixture(); f.ctx.settings.ideaPoolLimit = 3;
  await enter(f.ctx, at()); await goto(f.ctx, 'newIdeas', at());
  for (let i = 0; i < 7; i++) await addIdea(f.ctx, `new-${i}`, at(i));
  await goto(f.ctx, 'arena', at(7));
  await expect(goto(f.ctx, 'coldPick', at(7))).rejects.toThrow('上限');
  let rounds = 0;
  while (view(f).duel) { const pair = view(f).duel!; await duel(f.ctx, pair.left.id, pair.right.id, at(8 + rounds++)); }
  expect(rounds).toBe(4); await goto(f.ctx, 'coldPick', at(12));
  expect((await f.ctx.repos.records.list()).filter(row => row.value.pool === '活跃池')).toHaveLength(3);
});

it('going back to add an idea invalidates later step completion', async () => {
  const f = fixture(); await toCold(f); await goto(f.ctx, 'newIdeas', at()); await addIdea(f.ctx, 'later', at());
  expect(view(f).done).not.toContain('arena'); await expect(goto(f.ctx, 'coldPick', at())).rejects.toThrow('前面');
});

it('cold retrieval uses the existing rules, persists a confirmed duel, and resumes after restart', async () => {
  const f = fixture(); f.ctx.settings.ideaPoolLimit = 3; const rows = await ideas(f, 3, 2); await toCold(f);
  await expect(takeCold(f.ctx, [rows[3].id], at(10))).rejects.toThrow('确认');
  expect((await f.ctx.repos.records.get(rows[3].id))!.value.pool).toBe('冷库');
  expect(await takeCold(f.ctx, [rows[3].id], at(10), true)).toMatchObject({ kind: 'duel' });
  const restarted = createContext(f.ctx); await enter(restarted, at(11));
  expect(view(f)).toMatchObject({ step: 'coldPick', duel: { left: { id: rows[3].id }, right: { id: rows[0].id } } });
  await expect(finish(restarted, at(11))).rejects.toThrow('对决');
  await duel(restarted, rows[3].id, rows[0].id, at(12));
  expect((await saved(f))[0].status).toBe('已完成');
  expect((await f.ctx.repos.records.get(rows[3].id))!.value.pool).toBe('活跃池');
});

it('cold skip cancels a pending duel without touching either idea; available slots restore two directly', async () => {
  const f = fixture(); f.ctx.settings.ideaPoolLimit = 3; const rows = await ideas(f, 3, 2); await toCold(f);
  await takeCold(f.ctx, [rows[3].id], at(10), true); await skipCold(f.ctx, at(11));
  expect((await f.ctx.repos.records.get(rows[3].id))!.value).toEqual(rows[3]);
  expect((await f.ctx.repos.records.get(rows[0].id))!.value).toEqual(rows[0]);
  const g = fixture(); const cold = await ideas(g, 0, 2); await toCold(g);
  await takeCold(g.ctx, cold.map(row => row.id), at(3));
  expect((await g.ctx.repos.records.list()).every(row => row.value.pool === '活跃池')).toBe(true);
});

it('A8 continue extends the original deadline by one bet period and finishes after all due mains', async () => {
  const f = fixture(); f.ctx.settings.mainSlots = 2;
  const deadline = new Date(2026, 8, 1, 10).toISOString();
  await seed(f, [], [{ ...project('a'), bet_ends_at: deadline }, { ...project('b', '主线', 2), bet_ends_at: deadline }]);
  await toCold(f); await skipCold(f.ctx, at()); expect(view(f).bet?.project).toBe('a');
  await continueBet(f.ctx, at());
  expect((await f.ctx.repos.projects.get('a'))!.value.bet_ends_at).toBe(new Date(2026, 8, 29, 10).toISOString());
  expect(view(f).bet?.project).toBe('b');
  await continueBet(f.ctx, at()); expect((await saved(f))[0].status).toBe('已完成');
});

it('review projection keeps the exact id when advancing between identically named mains', async () => {
  const f = fixture(); f.ctx.settings.mainSlots = 2;
  await seed(f, [], ['first', 'second'].map((id, index) => ({ ...project(id, '主线', index + 1), name: '同名主线', bet_ends_at: at(-1) })));
  await toCold(f); await skipCold(f.ctx, at());
  expect(view(f).bet).toMatchObject({ projectId: 'first', project: '同名主线' });
  await continueBet(f.ctx, at()); expect(view(f).bet).toMatchObject({ projectId: 'second', project: '同名主线' });
  await switchMain(f.ctx, { name: 'new', slot: '主线', makeRoom: { id: view(f).bet!.projectId, action: '冷藏' } }, at());
  expect((await f.ctx.repos.projects.get('first'))!.value.status).toBe('进行中');
  expect((await f.ctx.repos.projects.get('second'))!.value.status).toBe('冷藏');
});

it.each(['冷藏', '放弃'] as const)('A8 changing main via create shares one commit with review completion (%s)', async action => {
  const f = fixture(); await seed(f, [card('old-card', { project_id: 'old' })], [{ ...project('old'), bet_ends_at: at(-1) }]);
  await toCold(f); await skipCold(f.ctx, at());
  const transact = vi.spyOn(f.ctx.repos, 'transact');
  await switchMain(f.ctx, { name: 'new', slot: '主线', makeRoom: { id: 'old', action } }, at());
  expect(transact).toHaveBeenCalledTimes(1);
  expect((await f.ctx.repos.projects.get('old'))!.value.status).toBe(action === '冷藏' ? '冷藏' : '已放弃');
  expect((await saved(f))[0].status).toBe('已完成');
  expect((await f.ctx.repos.projects.list()).find(row => row.value.name === 'new')!.value.slot).toBe('主线');
});

it('A8 restoring an existing main and invalid replacement both obey backpack transactions', async () => {
  const f = fixture(); await seed(f, [], [{ ...project('old'), bet_ends_at: at(-1) }, { ...project('restore'), slot: '不在背包', slot_index: null, status: '冷藏' }]);
  await toCold(f); await skipCold(f.ctx, at());
  await expect(switchMain(f.ctx, { name: ' ', slot: '主线', makeRoom: { id: 'old', action: '放弃' } }, at())).rejects.toThrow('不能为空');
  expect((await f.ctx.repos.projects.get('old'))!.value.status).toBe('进行中');
  expect((await saved(f))[0].status).toBe('进行中');
  await switchMain(f.ctx, { restoreId: 'restore', makeRoom: { id: 'old', action: '冷藏' } }, at());
  expect((await f.ctx.repos.projects.get('restore'))!.value.slot).toBe('主线');
  expect((await saved(f))[0].status).toBe('已完成');
});

it('a main explicitly removed in the backpack while reviewing does not strand the bet step on reentry', async () => {
  const f = fixture(); await seed(f, [], [{ ...project('old'), bet_ends_at: at(-1) }]);
  await toCold(f); await skipCold(f.ctx, at()); await freezeProject(f.ctx, 'old', at());
  await enter(f.ctx, at()); expect((await saved(f))[0].status).toBe('已完成');
});

it('recap spans superseded periods since the last completion, clips overlays, and includes unfinished progress notes', async () => {
  const f = fixture(); const date = (day: number, hour = 10) => new Date(2026, 9, day, hour).toISOString();
  await seed(f, [card('done', { status: '已完成', completed_at: date(25), completed_day: '2026-10-25', progress_note: 'done-note' }), card('pending')]);
  await run(f.ctx, async tx => {
    tx.state.first_used_day = '2026-10-01';
    tx.saveReview({ id: '2026-W41', period: '2026-W41', status: '已完成', step: 'done', completed_at: date(10) });
    tx.saveReview({ id: '2026-W42', period: '2026-W42', status: '已被取代', step: 'arena' });
    tx.saveCard({ ...tx.cards.find(card => card.id === 'pending')!, progress_note: 'unfinished-note' });
    const segment: Segment = { id: tx.id(), seq: tx.nextSeq(), started_at: date(10, 9), ended_at: date(10, 12), activity: 'task', category: '主线', card_id: 'done', kind: '普通', source: '手动', resume_card_id: null };
    const overlay: Segment = { ...segment, id: tx.id(), seq: tx.nextSeq(), started_at: date(10, 11), ended_at: date(10, 12), category: '生活', card_id: null, source: '补记' };
    tx.writes.push(...await tx.repos.times.writes([segment, overlay].map(segment => ({ day: activityDay(segment.started_at, 4), segment }))));
  }, date(26));
  await enter(f.ctx, at()); const recap = view(f).recap;
  expect(recap.completed.map(card => card.id)).toEqual(['done']);
  expect(recap.totals).toEqual(expect.arrayContaining([{ category: '主线', minutes: 60 }, { category: '生活', minutes: 60 }]));
  expect(recap.completed[0].minutes).toBe(60);
  expect(recap.notes.map(note => note.id).sort()).toEqual(['done', 'pending']);
  expect((await saved(f)).some(row => row.period === '2026-W43')).toBe(true);
});

it('progress noted by redraw is dated and visible even though the card is unfinished', async () => {
  const f = fixture(); await seed(f, [card('a')]); await start(f.ctx, 'a', at()); f.clock(at(1)); await redraw(f.ctx, 'a', at(1), '继续这里');
  f.clock(at(2)); await enter(f.ctx, at(2));
  expect(view(f).recap.notes).toEqual([{ id: 'a', content: 'a', note: '继续这里' }]);
  expect((await getCard(f, 'a')).progress_noted_at).toBe(at(1));
});

it('a repeated save cannot overwrite a progress timestamp assigned earlier in the same transaction', async () => {
  const f = fixture(); await seed(f, [card('a')]);
  await run(f.ctx, async tx => { const changed = { ...tx.cards[0], progress_note: 'new note' }; tx.saveCard(changed); tx.saveCard({ ...changed, skip_count: 1 }); }, at(1));
  expect((await getCard(f, 'a')).progress_noted_at).toBe(at(1));
});

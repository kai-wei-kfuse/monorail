import { expect, it } from 'vitest';
import { fixture, at, card, seed, task, open, getCard } from './serviceFixture';
import { createTask, addItem, setDefaultProject, saveCard, freezeTask, restoreTask } from './backpackService';
import { startCard, pause, resume, manual } from './homeService';
import { complete } from './cardService';
import { change, changeLists } from './settingsService';
import { saveRecord, reconcile } from './recordService';
import { convertIdeaToTask } from './ideaService';
import { parseEntryText } from '../shared/tags';

it('first split replaces an untracked marked placeholder, including at capacity, but retains tracked work', async () => {
  const f = fixture(); f.ctx.settings.mainItems = 1;
  const id = await createTask(f.ctx, { name: '方向', slot: '主线', makeRoom: null, items: ['[方向]'], defaultProject: '学习' }, at());
  const original = (await f.ctx.repos.cards.list())[0].value.id;
  expect(await addItem(f.ctx, id, '找一个例子', at())).toBe(original);
  expect(await f.ctx.repos.cards.list()).toHaveLength(1);
  await expect(addItem(f.ctx, id, '第二项', at())).rejects.toThrow('已满');
  const side = await createTask(f.ctx, { name: '运动', slot: '支线', makeRoom: null, items: [] }, at());
  const one = (await f.ctx.repos.cards.list()).find(e => e.value.task_id === side)!.value;
  await startCard(f.ctx, one.id, at()); f.clock(at(1)); await pause(f.ctx, at(1));
  await addItem(f.ctx, side, '慢跑', at(1));
  expect(f.publish.mock.calls.at(-1)![0].backpack.pool.sides[0].items).toHaveLength(2);
});
it('main item limits apply per task; reducing either capacity retains all existing tasks and items', async () => {
  const f = fixture(); f.ctx.settings.mainTasks = 2; f.ctx.settings.mainItems = 2;
  const a = await createTask(f.ctx, { name: 'a', slot: '主线', makeRoom: null, items: ['a1', 'a2'] }, at());
  await createTask(f.ctx, { name: 'b', slot: '主线', makeRoom: null, items: ['b1', 'b2'] }, at());
  await change(f.ctx, 'mainTasks', 1, at()); await change(f.ctx, 'mainItems', 1, at());
  const pool = f.publish.mock.calls.at(-1)![0].backpack.pool;
  expect(pool.mains).toHaveLength(2); expect(pool.mains.every(t => t.overLimit && t.items.length === 2)).toBe(true);
  await expect(addItem(f.ctx, a, 'a3', at())).rejects.toThrow('已满');
  await expect(createTask(f.ctx, { name: 'c', slot: '主线', makeRoom: null, items: ['c1'] }, at())).rejects.toThrow('已满');
});
it('E4 reconciles a captured todo over the side limit, marks excess and blocks only manual creation', async () => {
  const f = fixture(); f.ctx.settings.sideTasks = 1;
  await createTask(f.ctx, { name: '已有', slot: '支线', makeRoom: null, items: [] }, at());
  const recordId = crypto.randomUUID();
  await saveRecord(f.ctx, { id: recordId, text: '收集 #随手', kind: '待办', created_at: at(), due_at: null,
    blocking: false, task_id: null, card_id: null, tags: [], attachments: [] });
  expect(await reconcile(f.ctx)).toBe(1); expect(await reconcile(f.ctx)).toBe(0);
  const pool = f.publish.mock.calls.at(-1)![0].backpack.pool;
  expect(pool.sides).toHaveLength(2); expect(pool.excessSideIds).toEqual([`task-card-${recordId}`]);
  await expect(createTask(f.ctx, { name: '再开', slot: '支线', makeRoom: null, items: [] }, at())).rejects.toThrow('已满');
});
it('projects all item fields and fresh elapsed time; metadata edits retag only current time', async () => {
  const f = fixture(); await seed(f, [card('c', { task_id: 't', content: '[做事]', type: '时间盒卡', timebox_minutes: 25, blocking: true, due_at: at(90), shrink_level: 1 })], [task('t')]);
  await setDefaultProject(f.ctx, 't', '工作', at()); await startCard(f.ctx, 'c', at()); f.clock(at(10));
  await saveCard(f.ctx, 'c', { content: '[做事]', type: '时间盒卡', timeboxMinutes: 25, blocking: true, dueAt: at(90), noShrink: false, taskId: 't', project: '学习', tags: ['频繁'] }, at(10));
  expect(open(f)).toMatchObject({ description: '做事', project: '学习', tags: ['频繁'] });
  expect(f.publish.mock.calls.at(-1)![0].backpack.pool.mains[0]).toMatchObject({ defaultProject: '工作', items: [{ content: '[做事]', elapsedMs: 600000, running: true, shrinkLevel: 1, blocking: true, dueAt: at(90), project: '学习', tags: ['频繁'] }] });
  await pause(f.ctx, at(10)); await setDefaultProject(f.ctx, 't', '研究', at(10));
  await resume(f.ctx, at(10)); expect(open(f).project).toBe('学习');
  await changeLists(f.ctx, { tags: ['未用'] }, at(10));
  await manual(f.ctx, { description: '事', project: '工作', tags: ['低频'] }, at(-10), at(-5), at(10));
  expect(f.home().knownTags).toEqual(['频繁', '低频', '未用']);
});
it('side tasks complete automatically, main tasks stay active; freezing and restoring retain items', async () => {
  const f = fixture(); const id = await createTask(f.ctx, { name: '支线', slot: '支线', makeRoom: null, items: ['一件事'] }, at());
  const c = (await f.ctx.repos.cards.list())[0].value;
  await startCard(f.ctx, c.id, at()); await freezeTask(f.ctx, id, at());
  expect(open(f).project).toBe('待机'); expect(f.publish.mock.calls.at(-1)![0].backpack.pool.parked[0]).toMatchObject({ id, itemCount: 1 });
  await restoreTask(f.ctx, id, '支线', at()); await startCard(f.ctx, c.id, at()); await complete(f.ctx, c.id, at(), '完成');
  expect(f.publish.mock.calls.at(-1)![0].backpack.pool.doneSides).toEqual(['支线']);
  await seed(f, [card('main-card', { task_id: 'main' })], [task('main')]); await startCard(f.ctx, 'main-card', at()); await complete(f.ctx, 'main-card', at(), '完成');
  expect((await f.ctx.repos.tasks.get('main'))!.value.status).toBe('进行中');
});
it('ideas create multi-item tasks with tags and reject over-capacity conversions atomically', async () => {
  const f = fixture(), id = crypto.randomUUID();
  await saveRecord(f.ctx, { id, text: '想法 #研究', kind: '想法', created_at: at(), due_at: null, blocking: false, task_id: null, card_id: null, tags: [], attachments: [] });
  f.ctx.settings.mainItems = 1;
  const input = { name: '研究', slot: '主线' as const, defaultProject: '学习', items: ['读文献', '写笔记'] };
  await expect(convertIdeaToTask(f.ctx, id, input, at())).rejects.toThrow('已满');
  expect(await f.ctx.repos.tasks.list()).toHaveLength(0);
  const ids = await convertIdeaToTask(f.ctx, id, { ...input, slot: '支线' }, at());
  expect(ids).toHaveLength(2); expect(await getCard(f, ids[1])).toMatchObject({ tags: ['研究'], source_record_id: id });
});
it('shared text parsing preserves URL fragments and email addresses', () => {
  expect(parseEntryText('https://site/x#anchor user@example.com #标签 @工作', ['工作']))
    .toEqual({ description: 'https://site/x#anchor user@example.com', tags: ['标签'], project: '工作' });
});

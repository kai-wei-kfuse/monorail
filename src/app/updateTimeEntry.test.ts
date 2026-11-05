import { expect, it } from 'vitest';
import { handleApplicationRequest } from './applicationController';
import { at, card, entries, fixture, open, seed, task } from '../services/serviceFixture';
import { startCard } from '../services/homeService';
import { createProject } from '../services/presetService';
import { contextResult, updateTimeEntryResult, addTimeEntryResult } from '../shared/application';

/** 0.3.1 附带需求第 1 条：update_time_entry（执行方案 G8）。规则同日历，记操作历史，不能删除。 */
const ctxOf = async (f: ReturnType<typeof fixture>) => contextResult.parse(await handleApplicationRequest(f.ctx, { method: 'get_context', arguments: {} }));
const update = async (f: ReturnType<typeof fixture>, args: Record<string, unknown>) => {
  const c = await ctxOf(f);
  return handleApplicationRequest(f.ctx, { method: 'update_time_entry', arguments: { operation_id: c.operation_id, expected_state: c.expected_state, ...args } });
};

it('改已结束记录的时间和内容：时段、描述、项目、标签都能改；新时段盖住的记录在 overlaps 里；记历史 auto.update_time_entry', async () => {
  const f = fixture(); await seed(f, []);
  await createProject(f.ctx, '学习', at(0));
  f.clock(at(40));
  const c = await ctxOf(f);
  const added = addTimeEntryResult.parse(await handleApplicationRequest(f.ctx, { method: 'add_time_entry',
    arguments: { operation_id: c.operation_id, description: '听播客', start: at(10), end: at(20) } }));
  const id = added.data.entry.id;
  const other = addTimeEntryResult.parse(await handleApplicationRequest(f.ctx, { method: 'add_time_entry',
    arguments: { operation_id: added.next_operation_id, description: '散步', start: at(25), end: at(30), project: '学习' } }));
  f.clock(at(41));
  const result = updateTimeEntryResult.parse(await update(f, { entry_id: id, start: at(12), end: at(27), description: '听编译原理播客', project: '学习', tags: ['播客'] }));
  expect(result.data.entry).toMatchObject({ id, started_at: at(12), ended_at: at(27), description: '听编译原理播客', project: '学习', tags: ['播客'] });
  expect(result.data.overlaps).toContainEqual(expect.objectContaining({ id: other.data.entry.id, from: at(25), to: at(27) }));
  expect(entries(f).find(e => e.id === id)).toMatchObject({ started_at: at(12), ended_at: at(27), description: '听编译原理播客' });
  const history = (await f.ctx.repos.history.readDays('2000-01-01', '2999-12-31')).records;
  expect(history[0]).toMatchObject({ action: 'auto.update_time_entry', subject: { type: 'entry', id } });

  // 只改标签：其余不动；空数组清空标签
  const cleared = updateTimeEntryResult.parse(await update(f, { entry_id: id, tags: [] }));
  expect(cleared.data.entry).toMatchObject({ started_at: at(12), ended_at: at(27), tags: [] });
});

it('正在计时的那一条只能改开始；来自卡的记录描述和项目要在卡上改，标签可以改', async () => {
  const f = fixture(); await seed(f, [card('c1')], [task('t1')]);
  f.clock(at(10)); await startCard(f.ctx, 'c1', at(10));
  f.clock(at(30));
  const running = open(f);
  await expect(update(f, { entry_id: running.id, end: at(25) })).rejects.toThrow('ENTRY_RUNNING');
  await expect(update(f, { entry_id: running.id, description: '换个说法' })).rejects.toThrow('ENTRY_FROM_CARD');
  const moved = updateTimeEntryResult.parse(await update(f, { entry_id: running.id, start: at(5), tags: ['专注'] }));
  expect(moved.data.entry).toMatchObject({ id: running.id, started_at: at(5), ended_at: null, tags: ['专注'] });
  expect(open(f)).toMatchObject({ id: running.id, card_id: 'c1', started_at: at(5) });
});

it('找不到记录、状态变了、一项都不改：拒绝且不写', async () => {
  const f = fixture(); await seed(f, []);
  f.clock(at(10));
  await expect(update(f, { entry_id: 'missing', description: 'x' })).rejects.toThrow('ENTRY_NOT_FOUND');
  const c = await ctxOf(f);
  await expect(handleApplicationRequest(f.ctx, { method: 'update_time_entry',
    arguments: { operation_id: c.operation_id, expected_state: 'ts1:stale', entry_id: open(f).id, start: at(1) } })).rejects.toThrow('STATE_CHANGED');
  await expect(handleApplicationRequest(f.ctx, { method: 'update_time_entry',
    arguments: { operation_id: c.operation_id, expected_state: c.expected_state, entry_id: open(f).id } })).rejects.toThrow('至少要改一项');
});

// Independent review probes. These only use MemoryFs, never user data or native apps.
import { afterEach, expect, it, vi } from 'vitest';
import { setImmediate } from 'node:timers/promises';
import { handleApplicationRequest } from '../src/app/applicationController';
import { createApplicationClient } from '../client/applicationClient';
import { runCli } from '../cli/main';
import { fixture, seed } from '../src/services/serviceFixture';
import { run } from '../src/services/commit';
import { ApplicationError } from '../src/shared/appError';
import { createIdeaResult, findItemsResult, updateIdeaResult, completeIdeaResult, reopenIdeaResult, createTaskResult, getTaskDetailsResult } from '../src/shared/application';

afterEach(() => vi.restoreAllMocks());

async function makeIdea() {
  const f = fixture();
  await seed(f, []);
  const request = { method: 'create_idea', arguments: { operation_id: crypto.randomUUID(), title: '标题A #旧', details_markdown: '正文A' } };
  const created = createIdeaResult.parse(await handleApplicationRequest(f.ctx, request));
  return { f, request, created, id: created.data.idea.id };
}

it('R1: find_items returns one committed revision while a writer races its detail read', async () => {
  const { f, created, id } = await makeIdea();
  const repo = f.ctx.repos.records;
  const original = repo.getDetails.bind(repo);
  let release!: () => void;
  let announceRead!: () => void;
  const reading = new Promise<void>(resolve => { announceRead = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  vi.spyOn(repo, 'getDetails').mockImplementationOnce(async target => {
    announceRead();
    await gate;
    return original(target);
  });
  const pendingFind = handleApplicationRequest(f.ctx, { method: 'find_items', arguments: { kind: 'idea' } });
  await reading;
  let writerCommitted = false;
  const writer = handleApplicationRequest(f.ctx, {
    method: 'update_idea',
    arguments: { operation_id: crypto.randomUUID(), idea_id: id, record_revision: created.data.idea.record_revision, title: '标题B #新', details_markdown: '正文B' },
  }).then(result => { writerCommitted = true; return result; });
  // All MemoryFs work is promise based; one event-loop turn drains accepted work.
  await setImmediate();
  const committedWhileReadHeld = writerCommitted;
  release();
  const [found] = await Promise.all([pendingFind, writer]);
  const item = findItemsResult.parse(found).ideas[0];
  console.log('R1_OBSERVED', JSON.stringify({ committedWhileReadHeld, item }));
  expect(item.text).toBe('标题A #旧\n正文A');
  expect(item.tags).toEqual(['旧']);
});

it('R2: find_items surfaces a missing details record instead of reporting an empty body', async () => {
  const { f } = await makeIdea();
  vi.spyOn(f.ctx.repos.records, 'getDetails').mockResolvedValueOnce(null);
  await expect(handleApplicationRequest(f.ctx, { method: 'find_items', arguments: { kind: 'idea' } })).rejects.toThrow();
});

it('C1: create_idea replays the original receipt after edit and deletion without recreating data', async () => {
  const { f, request, created, id } = await makeIdea();
  await handleApplicationRequest(f.ctx, { method: 'update_idea', arguments: { operation_id: crypto.randomUUID(), idea_id: id, record_revision: created.data.idea.record_revision, title: '后来B' } });
  await run(f.ctx, async tx => { tx.removeRecord(id); }, undefined, { action: 'test.direct' });
  const replay = createIdeaResult.parse(await handleApplicationRequest(f.ctx, request));
  expect(replay.replayed).toBe(true);
  expect(replay.data).toEqual(created.data);
  expect(await f.ctx.repos.records.list()).toHaveLength(0);
  await expect(handleApplicationRequest(f.ctx, { ...request, arguments: { ...request.arguments, title: '参数C' } })).rejects.toThrow('OPERATION_CONFLICT');
  expect(await f.ctx.repos.records.list()).toHaveLength(0);
});

it('C2: CLI restores only the original edit revision after deletion and keeps changed business input conflicting', async () => {
  const { f, created, id } = await makeIdea();
  const editOp = crypto.randomUUID();
  const first = updateIdeaResult.parse(await handleApplicationRequest(f.ctx, { method: 'update_idea', arguments: { operation_id: editOp, idea_id: id, record_revision: created.data.idea.record_revision, title: '编辑B' } }));
  await run(f.ctx, async tx => { tx.removeRecord(id); }, undefined, { action: 'test.direct' });
  const client = createApplicationClient({ send: request => handleApplicationRequest(f.ctx, request) });
  async function execute(title: string) {
    let stdout = '';
    const exit = await runCli(['idea', 'edit', id, '--title', title, '--operation-id', editOp, '--json'], {
      createClient: () => client, writeStdout: text => { stdout += text; }, writeStderr: () => {}, env: {},
    });
    return { exit, body: JSON.parse(stdout) };
  }
  const replay = await execute('编辑B');
  expect(replay.exit).toBe(0);
  expect(replay.body.result.replayed).toBe(true);
  expect(replay.body.result.data).toEqual(first.data);
  const changed = await execute('编辑C');
  expect(changed.body.error.code).toBe('OPERATION_CONFLICT');
  expect(await f.ctx.repos.records.list()).toHaveLength(0);
});

it('C3: empty tasks are explicit while empty provided items and invalid result-card minutes cause zero writes', async () => {
  const f = fixture(); await seed(f, []);
  const client = createApplicationClient({ send: request => handleApplicationRequest(f.ctx, request) });
  const created = createTaskResult.parse(await client.call('create_task', { operation_id: crypto.randomUUID(), name: '空主线', slot: '主线' }));
  expect(created.data.created_card_ids).toEqual([]);
  const detail = getTaskDetailsResult.parse(await client.call('get_task_details', { task_id: created.data.task.id }));
  expect(detail.items).toEqual([]);
  const beforeTasks = (await f.ctx.repos.tasks.list()).length;
  await expect(client.call('create_task', { operation_id: crypto.randomUUID(), name: '非法空数组', slot: '主线', items: [] })).rejects.toMatchObject({ failure: { code: 'INVALID_INPUT' } });
  await expect(client.call('create_task', { operation_id: crypto.randomUUID(), name: '结果卡填分钟', slot: '主线', items: [{ content: '结果', type: '结果卡', timebox_minutes: 10 }] })).rejects.toMatchObject({ failure: { code: 'INVALID_INPUT' } });
  expect((await f.ctx.repos.tasks.list()).length).toBe(beforeTasks);
  expect(await f.ctx.repos.cards.list()).toEqual([]);
});

it('C4: complete/reopen legacy outputs retain full text and do not change the content revision', async () => {
  const { f, created, id } = await makeIdea();
  const done = completeIdeaResult.parse(await handleApplicationRequest(f.ctx, { method: 'complete_idea', arguments: { operation_id: crypto.randomUUID(), idea_id: id } }));
  expect(done.data.text).toBe('标题A #旧\n正文A');
  const reopened = reopenIdeaResult.parse(await handleApplicationRequest(f.ctx, { method: 'reopen_idea', arguments: { operation_id: crypto.randomUUID(), idea_id: id } }));
  expect(reopened.data.text).toBe('标题A #旧\n正文A');
  const details = await handleApplicationRequest(f.ctx, { method: 'get_idea_details', arguments: { idea_id: id } });
  expect((details as { idea: { record_revision: string } }).idea.record_revision).toBe(created.data.idea.record_revision);
});

it('R3: CLI rejects a known cross-method operation conflict without fabricating a revision after read failure', async () => {
  const { f, request, id } = await makeIdea();
  const sent: Array<{ method: string; arguments: unknown }> = [];
  const client = createApplicationClient({ send: async request => {
    sent.push({ method: request.method, arguments: request.arguments });
    if (request.method === 'get_idea_details') {
      throw new ApplicationError({ status: 'error', code: 'CONNECTION_LOST', category: 'result_unknown', message: 'injected read connection failure', next_step: 'inspect connection' });
    }
    return handleApplicationRequest(f.ctx, request);
  } });
  let stdout = '';
  await runCli(['idea', 'edit', id, '--title', '换方法', '--operation-id', request.arguments.operation_id, '--json'], {
    createClient: () => client, writeStdout: text => { stdout += text; }, writeStderr: () => {}, env: {},
  });
  console.log('R3_OBSERVED', JSON.stringify({ sent, result: JSON.parse(stdout) }));
  expect(JSON.parse(stdout).error.code).toBe('OPERATION_CONFLICT');
  expect(sent.map(request => request.method)).toEqual(['get_operation_result']);
});

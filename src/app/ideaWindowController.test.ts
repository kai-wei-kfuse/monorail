import { expect, it, vi } from 'vitest';
import { connectIdeaWindows } from './ideaWindowController';
import { handleApplicationRequest } from './applicationController';
import { at, fixture, seed } from '../services/serviceFixture';
import { createIdea, getIdeaDetails, updateIdea } from '../services/ideaService';
import { run } from '../services/commit';
import { createIdeaData, createIdeaResult, updateIdeaData, updateIdeaResult } from '../shared/application';
import type { IdeaWindowsPort } from '../platform/ideaWindows';
import type {
  IdeaDraftHandoffSnapshot,
  IdeaWindowCommand,
  IdeaWindowCommittedEvent,
  IdeaWindowReply,
} from '../shared/ideaWindow';

function createFakeIdeaWindowsPort() {
  let commandHandler: ((cmd: IdeaWindowCommand) => void) | null = null;
  let handoffHandler: ((event: {
    label: string;
    windowSession: string;
    mainEpoch: number;
    draftId: string;
    draftVersion: number;
    createOperationId: string;
    snapshot: unknown;
  }) => void) | null = null;
  const replies: Array<{ targetLabel: string; payload: IdeaWindowReply }> = [];
  const broadcasts: IdeaWindowCommittedEvent[] = [];
  const reboundDrafts: Array<{ draftId: string; recordId: string }> = [];

  const port: IdeaWindowsPort = {
    async openIdeaWindow() {
      return { label: 'idea-1', windowSession: 'ws-1', mainEpoch: 1, created: true };
    },
    async openIdeaDraftWindow() {
      return { label: 'idea-draft-1', windowSession: 'ws-draft-1', mainEpoch: 1, created: true };
    },
    async hello() {
      return {
        label: 'idea-1',
        windowSession: 'ws-1',
        mainEpoch: 1,
        kind: 'record',
        recordId: null,
        draftId: null,
        draftVersion: null,
        createOperationId: null,
        draftSnapshot: null,
      };
    },
    async send(_windowSession, _mainEpoch, cmd) {
      commandHandler?.(cmd);
    },
    async rebindDraftWindow(draftId, recordId) {
      reboundDrafts.push({ draftId, recordId });
    },
    async closeIdeaWindow() {},
    async closeAllIdeaWindows() {},
    async reply(targetLabel, payload) {
      replies.push({ targetLabel, payload });
    },
    async notifyCommitted(payload) {
      broadcasts.push(payload);
    },
    async subscribeCommands(handler) {
      commandHandler = handler;
      return () => {
        if (commandHandler === handler) commandHandler = null;
      };
    },
    async subscribeReplies() {
      return () => {};
    },
    async subscribeCommitted() {
      return () => {};
    },
    async subscribeDraftHandoff(handler) {
      handoffHandler = handler;
      return () => {
        if (handoffHandler === handler) handoffHandler = null;
      };
    },
    async mainUpdateReady() {},
    async ackDraftCheck() {},
    async beginMaintenanceCheck() {},
    async checkDraftsForMaintenance() {
      return 'dc-mock-1';
    },
    async cancelMaintenanceCheck() {},
    async focusDirtyWindow() {
      return null;
    },
    async performAppExit() {},
  };

  return {
    port,
    replies,
    broadcasts,
    reboundDrafts,
    emitCommand: (cmd: IdeaWindowCommand) => commandHandler?.(cmd),
    emitHandoff: (draftId: string, snapshot: IdeaDraftHandoffSnapshot) =>
      handoffHandler?.({
        label: 'idea-draft-1',
        windowSession: 'ws-draft-1',
        mainEpoch: 1,
        draftId,
        draftVersion: snapshot.draftVersion,
        createOperationId: snapshot.createOperationId,
        snapshot,
      }),
  };
}

async function flushAsync() {
  for (let i = 0; i < 6; i++) {
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

it('ADR 0028 W1–W4: loads idea with initialDraft, enforces mainEpoch & baseRevision on save, and replays durable save receipt', async () => {
  const f = fixture();
  await seed(f, []);
  const created = await createIdea(f.ctx, {
    title: '初始想法 #窗口',
    details_markdown: '初始正文',
    needs: '安静环境',
  }, at(0));

  const fake = createFakeIdeaWindowsPort();
  const controller = connectIdeaWindows(f.ctx, fake.port);

  await controller.openIdeaWindow(created.id, created.text, {
    baseRevision: created.recordRevision,
    title: '抽屉未保存标题 #窗口',
    detailsMarkdown: '抽屉未保存正文',
    needs: '安静环境',
    editMode: true,
  });

  // 1. Stale mainEpoch rejected with EPOCH_MISMATCH
  fake.emitCommand({
    kind: 'load',
    requestId: 'req-bad-epoch',
    windowLabel: 'idea-1',
    windowSession: 'ws-1',
    mainEpoch: f.ctx.mainEpoch + 99,
    recordId: created.id,
  });
  await flushAsync();
  expect(fake.replies.at(-1)?.payload).toMatchObject({
    kind: 'error',
    requestId: 'req-bad-epoch',
    code: 'EPOCH_MISMATCH',
  });

  // 2. Valid load returns idea + initialDraft
  fake.emitCommand({
    kind: 'load',
    requestId: 'req-load-1',
    windowLabel: 'idea-1',
    windowSession: 'ws-1',
    mainEpoch: f.ctx.mainEpoch,
    recordId: created.id,
  });
  await flushAsync();
  expect(fake.replies.at(-1)?.payload).toMatchObject({
    kind: 'loaded',
    requestId: 'req-load-1',
    idea: { id: created.id, text: '初始想法 #窗口', detailsMarkdown: '初始正文', recordRevision: created.recordRevision },
    initialDraft: { title: '抽屉未保存标题 #窗口', detailsMarkdown: '抽屉未保存正文' },
  });

  // 3. Save with matching baseRevision commits, updates revision, and writes durable receipt
  const saveOpId = crypto.randomUUID();
  fake.emitCommand({
    kind: 'save',
    requestId: 'req-save-1',
    windowLabel: 'idea-1',
    windowSession: 'ws-1',
    mainEpoch: f.ctx.mainEpoch,
    operationId: saveOpId,
    recordId: created.id,
    baseRevision: created.recordRevision,
    text: '独立窗已保存标题 #窗口 #新标签',
    detailsMarkdown: '独立窗已保存正文 #详情标签',
    needs: '整块时间',
    at: at(5),
  });
  await flushAsync();
  const savedReply = fake.replies.at(-1)!.payload;
  expect(savedReply).toMatchObject({
    kind: 'saved',
    requestId: 'req-save-1',
    replayed: false,
    idea: {
      id: created.id,
      text: '独立窗已保存标题 #窗口 #新标签',
      detailsMarkdown: '独立窗已保存正文 #详情标签',
      tags: ['窗口', '新标签', '详情标签'],
      needs: '整块时间',
    },
  });
  const revAfterSave = (savedReply as Extract<IdeaWindowReply, { kind: 'saved' }>).idea.recordRevision;
  expect(revAfterSave).not.toBe(created.recordRevision);

  // 4. Stale baseRevision rejected with CONFLICT and currentIdea attached
  fake.emitCommand({
    kind: 'save',
    requestId: 'req-save-stale',
    windowLabel: 'idea-1',
    windowSession: 'ws-1',
    mainEpoch: f.ctx.mainEpoch,
    operationId: crypto.randomUUID(),
    recordId: created.id,
    baseRevision: created.recordRevision,
    text: '基于旧修订的保存',
    detailsMarkdown: '不应覆盖',
    needs: null,
    at: at(6),
  });
  await flushAsync();
  expect(fake.replies.at(-1)?.payload).toMatchObject({
    kind: 'error',
    requestId: 'req-save-stale',
    code: 'CONFLICT',
    currentIdea: { id: created.id, recordRevision: revAfterSave },
  });

  // 5. Replaying saveOpId with original baseRevision returns replayed=true
  fake.emitCommand({
    kind: 'save',
    requestId: 'req-save-replay',
    windowLabel: 'idea-1',
    windowSession: 'ws-1',
    mainEpoch: f.ctx.mainEpoch,
    operationId: saveOpId,
    recordId: created.id,
    baseRevision: created.recordRevision,
    text: '独立窗已保存标题 #窗口 #新标签',
    detailsMarkdown: '独立窗已保存正文 #详情标签',
    needs: '整块时间',
    at: at(7),
  });
  await flushAsync();
  expect(fake.replies.at(-1)?.payload).toMatchObject({
    kind: 'saved',
    requestId: 'req-save-replay',
    replayed: true,
  });

  controller.dispose();
});

it('ADR 0028 QW2: draft-create replays original receipt even after edit or deletion, and rejects modified parameters on same createOperationId without creating a second record', async () => {
  const f = fixture();
  await seed(f, []);
  const fake = createFakeIdeaWindowsPort();
  const controller = connectIdeaWindows(f.ctx, fake.port);

  const draftId = crypto.randomUUID();
  const createOpId = crypto.randomUUID();
  const snapshot: IdeaDraftHandoffSnapshot = {
    draftId,
    draftVersion: 1,
    createOperationId: createOpId,
    title: '未落盘草稿标题 #草稿',
    detailsMarkdown: '未落盘草稿正文',
    needs: '专注',
    taskId: null,
    attachments: [],
    createdAt: at(0),
  };
  await controller.openIdeaDraftWindow(snapshot);

  // 1. First draft-create from standalone window commits and rebinds draftId -> recordId
  fake.emitCommand({
    kind: 'draft-create',
    requestId: 'req-dc-1',
    windowLabel: 'idea-draft-1',
    windowSession: 'ws-draft-1',
    mainEpoch: f.ctx.mainEpoch,
    draftId,
    draftVersion: 1,
    createOperationId: createOpId,
    text: '未落盘草稿标题 #草稿',
    detailsMarkdown: '未落盘草稿正文',
    needs: '专注',
    taskId: null,
    attachments: [],
    at: at(1),
  });
  await flushAsync();
  const createdReply = fake.replies.at(-1)!.payload as Extract<IdeaWindowReply, { kind: 'draft-created' }>;
  expect(createdReply).toMatchObject({
    kind: 'draft-created',
    replayed: false,
    draftId,
    idea: { text: '未落盘草稿标题 #草稿', detailsMarkdown: '未落盘草稿正文' },
  });
  const createdId = createdReply.idea.id;
  expect(fake.reboundDrafts).toEqual([{ draftId, recordId: createdId }]);
  expect(await f.ctx.repos.records.list()).toHaveLength(1);

  // 2. Subsequent edit changes the record's title on disk
  await updateIdea(f.ctx, {
    id: createdId,
    recordRevision: createdReply.idea.recordRevision,
    title: '后续已修改的标题 #草稿',
  });
  expect((await getIdeaDetails(f.ctx, createdId)).title).toBe('后续已修改的标题 #草稿');

  // 3. Replaying exact original draft-create request (even after record was edited) returns replayed=true AND the original frozen receipt snapshot!
  fake.emitCommand({
    kind: 'draft-create',
    requestId: 'req-dc-replay-after-edit',
    windowLabel: 'quickbar',
    windowSession: 'quickbar',
    mainEpoch: f.ctx.mainEpoch,
    draftId,
    draftVersion: 1,
    createOperationId: createOpId,
    text: '未落盘草稿标题 #草稿',
    detailsMarkdown: '未落盘草稿正文',
    needs: '专注',
    taskId: null,
    attachments: [],
    at: at(2),
  });
  await flushAsync();
  expect(fake.replies.at(-1)?.payload).toMatchObject({
    kind: 'draft-created',
    requestId: 'req-dc-replay-after-edit',
    replayed: true,
    idea: {
      id: createdId,
      text: '未落盘草稿标题 #草稿',
      detailsMarkdown: '未落盘草稿正文',
      recordRevision: createdReply.idea.recordRevision,
    },
  });
  expect(await f.ctx.repos.records.list()).toHaveLength(1);

  // 3b. query-receipt (both in-memory and cold durable disk read) returns the original frozen receipt snapshot, NOT the mutated record!
  fake.emitCommand({
    kind: 'query-receipt',
    requestId: 'req-qr-mem',
    operationId: createOpId,
    windowLabel: 'idea-draft-1',
    windowSession: 'ws-draft-1',
    mainEpoch: f.ctx.mainEpoch,
  });
  await flushAsync();
  expect(fake.replies.at(-1)?.payload).toMatchObject({
    kind: 'receipt',
    requestId: 'req-qr-mem',
    status: 'committed',
    idea: {
      id: createdId,
      text: '未落盘草稿标题 #草稿',
      detailsMarkdown: '未落盘草稿正文',
      recordRevision: createdReply.idea.recordRevision,
    },
  });

  // Cold controller instance (no in-memory committedReceipts cache) reading durable receipt from disk:
  controller.dispose();
  const controllerCold = connectIdeaWindows(f.ctx, fake.port);
  fake.emitCommand({
    kind: 'query-receipt',
    requestId: 'req-qr-cold',
    operationId: createOpId,
    windowLabel: 'idea-draft-1',
    windowSession: 'ws-draft-1',
    mainEpoch: f.ctx.mainEpoch,
  });
  await flushAsync();
  expect(fake.replies.at(-1)?.payload).toMatchObject({
    kind: 'receipt',
    requestId: 'req-qr-cold',
    status: 'committed',
    idea: {
      id: createdId,
      text: '未落盘草稿标题 #草稿',
      detailsMarkdown: '未落盘草稿正文',
      recordRevision: createdReply.idea.recordRevision,
    },
  });

  // 4. Same createOperationId with modified text from QuickBar rejects with CONFLICT and does NOT create a second record
  fake.emitCommand({
    kind: 'draft-create',
    requestId: 'req-dc-conflict',
    windowLabel: 'quickbar',
    windowSession: 'quickbar',
    mainEpoch: f.ctx.mainEpoch,
    draftId,
    draftVersion: 2,
    createOperationId: createOpId,
    text: '原条后写的新标题 #草稿',
    detailsMarkdown: '未落盘草稿正文',
    needs: '专注',
    taskId: null,
    attachments: [],
    at: at(3),
  });
  await flushAsync();
  expect(fake.replies.at(-1)?.payload).toMatchObject({
    kind: 'error',
    requestId: 'req-dc-conflict',
    code: 'CONFLICT',
    currentIdea: { id: createdId, text: '后续已修改的标题 #草稿' },
  });
  expect(await f.ctx.repos.records.list()).toHaveLength(1);

  // 5. Even if the record is subsequently deleted, replaying original request returns frozen receipt and modified request still conflicts with 0 records on disk!
  await run(f.ctx, async tx => { tx.removeRecord(createdId); }, undefined, { action: 'test.direct' });
  expect(await f.ctx.repos.records.list()).toHaveLength(0);

  fake.emitCommand({
    kind: 'draft-create',
    requestId: 'req-dc-replay-after-delete',
    windowLabel: 'idea-draft-1',
    windowSession: 'ws-draft-1',
    mainEpoch: f.ctx.mainEpoch,
    draftId,
    draftVersion: 1,
    createOperationId: createOpId,
    text: '未落盘草稿标题 #草稿',
    detailsMarkdown: '未落盘草稿正文',
    needs: '专注',
    taskId: null,
    attachments: [],
    at: at(4),
  });
  await flushAsync();
  expect(fake.replies.at(-1)?.payload).toMatchObject({
    kind: 'draft-created',
    requestId: 'req-dc-replay-after-delete',
    replayed: true,
    idea: {
      id: createdId,
      text: '未落盘草稿标题 #草稿',
      detailsMarkdown: '未落盘草稿正文',
      recordRevision: createdReply.idea.recordRevision,
    },
  });
  expect(await f.ctx.repos.records.list()).toHaveLength(0);

  controllerCold.dispose();
});

it('query-receipt distinguishes not_found vs unknown on readOperation failure, and bound save preserves attachments', async () => {
  const f = fixture();
  await seed(f, []);
  const created = await createIdea(f.ctx, {
    title: '初始想法 #附件',
    details_markdown: '初始正文',
    attachments: ['attachments/init-a.png'],
  }, at(0));

  const fake = createFakeIdeaWindowsPort();
  const controller = connectIdeaWindows(f.ctx, fake.port);

  // 1. Bound save from QuickBar appends new attachments without losing existing ones and freezes receipt snapshot
  const boundSaveOpId = crypto.randomUUID();
  fake.emitCommand({
    kind: 'save',
    requestId: 'req-bound-save-1',
    windowLabel: 'quickbar',
    windowSession: 'quickbar',
    mainEpoch: f.ctx.mainEpoch,
    operationId: boundSaveOpId,
    recordId: created.id,
    baseRevision: created.recordRevision,
    text: '绑定更新后标题 #附件',
    detailsMarkdown: '绑定更新后正文',
    needs: '耳机',
    attachments: ['attachments/new-b.png'],
    at: at(1),
  });
  await flushAsync();
  const boundSavedReply = fake.replies.at(-1)!.payload as Extract<IdeaWindowReply, { kind: 'saved' }>;
  expect(boundSavedReply).toMatchObject({
    kind: 'saved',
    replayed: false,
    idea: {
      id: created.id,
      text: '绑定更新后标题 #附件',
      detailsMarkdown: '绑定更新后正文',
      needs: '耳机',
    },
  });
  const docAfterBoundSave = await getIdeaDetails(f.ctx, created.id);
  expect(docAfterBoundSave.attachments).toEqual(['attachments/init-a.png', 'attachments/new-b.png']);

  // Modify record again so live state differs from boundSaveOpId's frozen snapshot
  await updateIdea(f.ctx, {
    id: created.id,
    recordRevision: docAfterBoundSave.recordRevision,
    title: '第三次修改后的标题 #附件',
  });

  // Replay boundSaveOpId returns the frozen snapshot ('绑定更新后标题 #附件'), NOT '第三次修改后的标题 #附件'
  fake.emitCommand({
    kind: 'save',
    requestId: 'req-bound-save-replay',
    windowLabel: 'quickbar',
    windowSession: 'quickbar',
    mainEpoch: f.ctx.mainEpoch,
    operationId: boundSaveOpId,
    recordId: created.id,
    baseRevision: created.recordRevision,
    text: '绑定更新后标题 #附件',
    detailsMarkdown: '绑定更新后正文',
    needs: '耳机',
    attachments: ['attachments/new-b.png'],
    at: at(2),
  });
  await flushAsync();
  expect(fake.replies.at(-1)?.payload).toMatchObject({
    kind: 'saved',
    requestId: 'req-bound-save-replay',
    replayed: true,
    idea: {
      id: created.id,
      text: '绑定更新后标题 #附件',
      detailsMarkdown: '绑定更新后正文',
      recordRevision: boundSavedReply.idea.recordRevision,
    },
  });

  // 2. query-receipt for non-existent operation returns status: 'not_found'
  fake.emitCommand({
    kind: 'query-receipt',
    requestId: 'req-qr-missing',
    operationId: crypto.randomUUID(),
    windowLabel: 'quickbar',
    windowSession: 'quickbar',
    mainEpoch: f.ctx.mainEpoch,
  });
  await flushAsync();
  expect(fake.replies.at(-1)?.payload).toMatchObject({
    kind: 'receipt',
    requestId: 'req-qr-missing',
    status: 'not_found',
    idea: null,
  });

  // 3. query-receipt when readOperation fails (e.g. disk I/O or parse error) returns status: 'unknown' (NEVER 'not_found'!)
  const corruptOpId = crypto.randomUUID().toLowerCase();
  vi.spyOn(f.ctx.repos.receipts, 'get').mockRejectedValueOnce(new Error('disk I/O read failure'));
  fake.emitCommand({
    kind: 'query-receipt',
    requestId: 'req-qr-corrupt',
    operationId: corruptOpId,
    windowLabel: 'quickbar',
    windowSession: 'quickbar',
    mainEpoch: f.ctx.mainEpoch,
  });
  await flushAsync();
  expect(fake.replies.at(-1)?.payload).toMatchObject({
    kind: 'receipt',
    requestId: 'req-qr-corrupt',
    status: 'unknown',
    idea: null,
  });

  controller.dispose();
});

it('B1 & B2: window save and draft-create write strict shared receipt data without windowDoc, replay identically via public API, and reconstruct accurately after controller restart', async () => {
  const f = fixture();
  await seed(f, []);
  const fake1 = createFakeIdeaWindowsPort();
  const controller1 = connectIdeaWindows(f.ctx, fake1.port);

  const draftId = crypto.randomUUID();
  const createOpId = crypto.randomUUID();
  await controller1.openIdeaDraftWindow({
    draftId,
    draftVersion: 1,
    createOperationId: createOpId,
    title: '跨入口草稿 #跨入口',
    detailsMarkdown: '草稿详情正文',
    needs: null,
    taskId: null,
    attachments: [],
    createdAt: at(0),
  });

  fake1.emitCommand({
    kind: 'draft-create',
    requestId: 'req-interop-create',
    windowLabel: 'idea-draft-interop',
    windowSession: 'ws-interop',
    mainEpoch: f.ctx.mainEpoch,
    draftId,
    draftVersion: 1,
    createOperationId: createOpId,
    text: '跨入口草稿 #跨入口',
    detailsMarkdown: '草稿详情正文',
    needs: null,
    taskId: null,
    attachments: [],
    at: at(1),
  });
  await flushAsync();
  const createdReply = fake1.replies.at(-1)!.payload as Extract<IdeaWindowReply, { kind: 'draft-created' }>;
  expect(createdReply.kind).toBe('draft-created');
  const ideaId = createdReply.idea.id;
  const rev1 = createdReply.idea.recordRevision;

  // Public create_idea replays the window draft-create receipt with replayed: true and strict createIdeaData
  const publicCreateReplay = createIdeaResult.parse(await handleApplicationRequest(f.ctx, {
    method: 'create_idea',
    arguments: {
      operation_id: createOpId,
      title: '跨入口草稿 #跨入口',
      details_markdown: '草稿详情正文',
      needs: null,
    },
  }));
  expect(publicCreateReplay.replayed).toBe(true);
  expect(createIdeaData.safeParse(publicCreateReplay.data).success).toBe(true);
  expect('windowDoc' in (publicCreateReplay.data as Record<string, unknown>)).toBe(false);

  // Window save writes strict updateIdeaData receipt and replays identically via public update_idea
  const saveOpId = crypto.randomUUID();
  fake1.emitCommand({
    kind: 'save',
    requestId: 'req-interop-save',
    windowLabel: 'idea-interop',
    windowSession: 'ws-interop',
    mainEpoch: f.ctx.mainEpoch,
    operationId: saveOpId,
    recordId: ideaId,
    baseRevision: rev1,
    text: '跨入口保存后标题 #跨入口',
    detailsMarkdown: '跨入口保存后详情',
    needs: '安静环境',
    at: at(2),
  });
  await flushAsync();
  const savedReply = fake1.replies.at(-1)!.payload as Extract<IdeaWindowReply, { kind: 'saved' }>;
  expect(savedReply.kind).toBe('saved');
  const rev2 = savedReply.idea.recordRevision;

  const publicSaveReplay = updateIdeaResult.parse(await handleApplicationRequest(f.ctx, {
    method: 'update_idea',
    arguments: {
      operation_id: saveOpId,
      idea_id: ideaId,
      record_revision: rev1,
      title: '跨入口保存后标题 #跨入口',
      details_markdown: '跨入口保存后详情',
      needs: '安静环境',
    },
  }));
  expect(publicSaveReplay.replayed).toBe(true);
  expect(updateIdeaData.safeParse(publicSaveReplay.data).success).toBe(true);
  expect('windowDoc' in (publicSaveReplay.data as Record<string, unknown>)).toBe(false);

  controller1.dispose();

  // Simulate main window controller restart (empty in-memory committedReceipts map)
  const fake2 = createFakeIdeaWindowsPort();
  const controller2 = connectIdeaWindows(f.ctx, fake2.port);

  fake2.emitCommand({
    kind: 'query-receipt',
    requestId: 'req-qr-after-restart',
    operationId: saveOpId,
    windowLabel: 'idea-interop',
    windowSession: 'ws-interop',
    mainEpoch: f.ctx.mainEpoch,
  });
  await flushAsync();
  expect(fake2.replies.at(-1)?.payload).toMatchObject({
    kind: 'receipt',
    requestId: 'req-qr-after-restart',
    status: 'committed',
    idea: {
      id: ideaId,
      text: '跨入口保存后标题 #跨入口',
      detailsMarkdown: '跨入口保存后详情',
      needs: '安静环境',
      recordRevision: rev2,
    },
  });

  // Partial CLI/MCP title-only update receipt (without details_markdown in input when has_details is true) reports status: 'unknown' instead of fabricating empty details
  const titleOnlyOpId = crypto.randomUUID();
  await handleApplicationRequest(f.ctx, {
    method: 'update_idea',
    arguments: {
      operation_id: titleOnlyOpId,
      idea_id: ideaId,
      record_revision: rev2,
      title: '仅改标题不传详情 #跨入口',
    },
  });
  fake2.emitCommand({
    kind: 'query-receipt',
    requestId: 'req-qr-partial',
    operationId: titleOnlyOpId,
    windowLabel: 'idea-interop',
    windowSession: 'ws-interop',
    mainEpoch: f.ctx.mainEpoch,
  });
  await flushAsync();
  expect(fake2.replies.at(-1)?.payload).toMatchObject({
    kind: 'receipt',
    requestId: 'req-qr-partial',
    status: 'unknown',
    idea: null,
  });

  // Explicit taskId: null on window save clears existing task association and conflicts with omitted taskId on replay
  const linked = await createIdea(f.ctx, {
    title: '已关联任务的想法 #关联',
    details_markdown: '初始详情',
    taskId: 'main-task-1',
  }, at(4));
  const clearTaskOpId = crypto.randomUUID();
  fake2.emitCommand({
    kind: 'save',
    requestId: 'req-clear-task-1',
    recordId: linked.id,
    windowLabel: 'quickbar',
    windowSession: 'quickbar',
    mainEpoch: f.ctx.mainEpoch,
    operationId: clearTaskOpId,
    baseRevision: linked.recordRevision,
    text: '已关联任务的想法 #关联',
    detailsMarkdown: '初始详情',
    needs: null,
    taskId: null,
    at: at(5),
  });
  await flushAsync();
  expect(fake2.replies.at(-1)?.payload).toMatchObject({
    kind: 'saved',
    requestId: 'req-clear-task-1',
    replayed: false,
    idea: { id: linked.id, taskId: null },
  });
  const storedAfterClear = await getIdeaDetails(f.ctx, linked.id);
  expect(storedAfterClear.taskId).toBeNull();

  // Replaying the same operationId with omitted taskId must conflict (OPERATION_CONFLICT)
  fake2.emitCommand({
    kind: 'save',
    requestId: 'req-clear-task-omitted-replay',
    recordId: linked.id,
    windowLabel: 'idea-interop',
    windowSession: 'ws-interop',
    mainEpoch: f.ctx.mainEpoch,
    operationId: clearTaskOpId,
    baseRevision: linked.recordRevision,
    text: '已关联任务的想法 #关联',
    detailsMarkdown: '初始详情',
    needs: null,
    at: at(6),
  });
  await flushAsync();
  expect(fake2.replies.at(-1)?.payload).toMatchObject({
    kind: 'error',
    requestId: 'req-clear-task-omitted-replay',
    code: 'CONFLICT',
  });

  controller2.dispose();
});

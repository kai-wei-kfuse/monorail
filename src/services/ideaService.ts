import type { RecordEntry } from '../domain/record/record';
import { computeRecordRevision, createRecordWithDetails, extractRecordTags, normalizeBody } from '../domain/record/record';
export { normalizeBody };
import { convert } from '../domain/record/convert';
import { activeIdeas, clearDone, completeIdea, ideaStatus, requireIdea, reviveIdea, uncompleteIdea, weakest, expiredIdeas } from '../domain/idea/pool';
import type { IdeaStatus } from '../domain/idea/pool';
import type { IdeaCompletedBy } from '../domain/record/record';
import type { HistorySource } from '../shared/history';
import { decide, pair } from '../domain/idea/arena';
import type { Duel } from '../domain/idea/arena';
import type { Ctx, Transaction } from './commit';
import { readSerial, run } from './commit';
import { refreshInTx } from './dealService';
import { MainTaskItemsFullError, TaskCapacityFullError } from './backpackService';
import { taskWithItems } from '../domain/task/create';
import { canAddTask, itemCapacity } from '../domain/task/pool';
import { inBackpack } from '../domain/task/task';
import type { BackpackSlot, TaskItemDraft } from '../shared/backpack';

export interface IdeaSummaryDto {
  id: string;
  title: string;
  tags: string[];
  needs: string | null;
  attachments: string[];
  pool: IdeaStatus;
  created_at: string;
  last_touched_at: string;
  has_details: boolean;
  record_revision: string;
}

export interface IdeaDocument {
  id: string;
  text: string;
  detailsMarkdown: string;
  hasDetails: boolean;
  tags: string[];
  needs: string | null;
  attachments: string[];
  pool: IdeaStatus;
  createdAt: string;
  lastTouchedAt: string | null;
  completedAt: string | null;
  completedBy: IdeaCompletedBy | null;
  recordRevision: string;
  taskId: string | null;
}

export interface IdeaDocumentDto extends IdeaSummaryDto, IdeaDocument {
  details_markdown: string;
}

export function toIdeaDocument(
  record: RecordEntry,
  meta: { hasDetails: boolean; recordRevision: string; detailsMarkdown: string },
): IdeaDocumentDto {
  const summary = toIdeaSummary(record, meta);
  return {
    ...summary,
    details_markdown: meta.detailsMarkdown,
    text: record.text,
    detailsMarkdown: meta.detailsMarkdown,
    hasDetails: meta.hasDetails,
    createdAt: record.created_at,
    lastTouchedAt: record.last_touched_at,
    completedAt: record.completed_at ?? null,
    completedBy: record.completed_by ?? null,
    recordRevision: meta.recordRevision,
    taskId: record.task_id ?? null,
  };
}

export function toIdeaSummary(
  record: RecordEntry,
  meta: { hasDetails: boolean; recordRevision: string },
): IdeaSummaryDto {
  requireIdea(record);
  const status = ideaStatus(record) ?? '活跃池';
  return {
    id: record.id,
    title: record.text,
    tags: [...record.tags],
    needs: record.needs,
    attachments: [...record.attachments],
    pool: status,
    created_at: record.created_at,
    last_touched_at: record.last_touched_at,
    has_details: meta.hasDetails,
    record_revision: meta.recordRevision,
  };
}

export class RecordChangedError extends Error {
  readonly code = 'RECORD_CHANGED' as const;
  readonly idea: IdeaSummaryDto;
  constructor(idea: IdeaSummaryDto, message = 'RECORD_CHANGED：想法内容已变更，请刷新后重试') {
    super(message);
    this.name = 'RecordChangedError';
    this.idea = idea;
  }
}

function findIdea(tx: Transaction, id: string): RecordEntry {
  const record = tx.records.find(item => item.id === id);
  if (!record) throw new Error('IDEA_NOT_FOUND：想法不存在');
  requireIdea(record);
  return record;
}

export function ideaSummaryInTx(tx: Transaction, record: RecordEntry): IdeaSummaryDto {
  const sum = tx.recordSummary(record.id);
  const hasDetails = sum?.hasDetails ?? false;
  const recordRevision = sum?.recordRevision ?? computeRecordRevision({
    id: record.id,
    text: record.text,
    details_markdown: '',
    needs: record.needs,
    tags: record.tags,
    attachments: record.attachments,
  });
  return toIdeaSummary(record, { hasDetails, recordRevision });
}

export interface CreateIdeaServiceInput {
  id?: string;
  title?: string;
  text?: string;
  details_markdown?: string;
  detailsMarkdown?: string;
  needs?: string | null;
  taskId?: string | null;
  attachments?: string[];
  created_via?: 'quickbar';
}

export type CanonicalCreateIdeaOperationInput = {
  title: string;
  details_markdown: string;
  needs: string | null;
  task_id?: string;
  attachments?: string[];
};

export function normalizeCreateIdeaOperationInput(input: {
  title: string;
  details_markdown?: string;
  needs?: string | null;
  task_id?: string | null;
  attachments?: string[];
}): CanonicalCreateIdeaOperationInput {
  const trimmedNeeds = input.needs?.trim() || null;
  const trimmedTaskId = input.task_id?.trim() || null;
  const attachments = input.attachments?.filter(a => a.length > 0) ?? [];
  return {
    title: input.title,
    details_markdown: normalizeBody(input.details_markdown ?? ''),
    needs: trimmedNeeds,
    ...(trimmedTaskId !== null ? { task_id: trimmedTaskId } : {}),
    ...(attachments.length > 0 ? { attachments: [...attachments] } : {}),
  };
}

export type CanonicalUpdateIdeaOperationInput = {
  idea_id: string;
  record_revision: string;
  title?: string;
  details_markdown?: string;
  needs?: string | null;
  task_id?: string | null;
  attachments?: string[];
};

export function normalizeUpdateIdeaOperationInput(input: {
  idea_id: string;
  record_revision: string;
  title?: string;
  details_markdown?: string;
  needs?: string | null;
  task_id?: string | null;
  attachments?: string[];
}): CanonicalUpdateIdeaOperationInput {
  const attachments = input.attachments?.filter(a => a.length > 0) ?? [];
  return {
    idea_id: input.idea_id.toLowerCase(),
    record_revision: input.record_revision,
    ...(input.title !== undefined ? { title: input.title } : {}),
    ...(input.details_markdown !== undefined ? { details_markdown: normalizeBody(input.details_markdown) } : {}),
    ...(input.needs !== undefined ? { needs: input.needs?.trim() || null } : {}),
    ...(input.task_id !== undefined ? { task_id: input.task_id?.trim() || null } : {}),
    ...(attachments.length > 0 ? { attachments: [...attachments] } : {}),
  };
}

export function createIdeaInTx(
  tx: Transaction,
  input: CreateIdeaServiceInput,
): { record: RecordEntry; idea: IdeaSummaryDto; document: IdeaDocumentDto } {
  const id = input.id ?? tx.id();
  if (tx.records.some(item => item.id === id)) throw new Error('记录已经存在');
  const rawTitle = input.title ?? input.text ?? '';
  const rawDetails = input.details_markdown ?? input.detailsMarkdown ?? '';
  const created = createRecordWithDetails({
    id,
    text: rawTitle,
    details: rawDetails,
    kind: '想法',
    created_at: tx.at,
    due_at: null,
    blocking: false,
    task_id: input.taskId ?? null,
    card_id: null,
    tags: [],
    attachments: input.attachments ?? [],
    needs: input.needs ?? null,
    ...(input.created_via ? { created_via: input.created_via } : {}),
  });
  tx.saveRecord(created.record, created.details);
  const summary = ideaSummaryInTx(tx, created.record);
  const document = toIdeaDocument(created.record, {
    hasDetails: summary.has_details,
    recordRevision: summary.record_revision,
    detailsMarkdown: created.details,
  });
  return { record: created.record, idea: summary, document };
}

export const createIdea = (ctx: Ctx, input: CreateIdeaServiceInput, at?: string, source?: HistorySource) =>
  run(ctx, async tx => (await createIdeaInTx(tx, input)).document, at, { action: 'idea.create', ...(source ? { source } : {}) });

export async function getIdeaDetails(ctx: Ctx, id: string, signal?: AbortSignal): Promise<IdeaDocumentDto> {
  return readSerial(ctx, async () => {
    const detail = await ctx.repos.records.getDetails(id);
    if (!detail) throw new Error('IDEA_NOT_FOUND：想法不存在');
    requireIdea(detail.value);
    return toIdeaDocument(detail.value, {
      hasDetails: detail.hasDetails,
      recordRevision: detail.recordRevision,
      detailsMarkdown: detail.body,
    });
  }, signal);
}

export interface UpdateIdeaServiceInput {
  id: string;
  recordRevision?: string;
  expectedRecordRevision?: string;
  title?: string;
  text?: string;
  details_markdown?: string;
  detailsMarkdown?: string;
  needs?: string | null;
  taskId?: string | null;
  appendAttachments?: string[];
}
export type UpdateIdeaInput = UpdateIdeaServiceInput;

export async function updateIdeaInTx(
  tx: Transaction,
  input: UpdateIdeaServiceInput,
): Promise<{ record: RecordEntry; idea: IdeaSummaryDto; document: IdeaDocumentDto; noop: boolean }> {
  const idea = findIdea(tx, input.id);
  const targetDetails = await tx.readRecordDetails(input.id);
  if (!targetDetails) throw new Error('IDEA_NOT_FOUND：想法不存在');
  const currentSummary = toIdeaSummary(idea, {
    hasDetails: targetDetails.hasDetails,
    recordRevision: targetDetails.recordRevision,
  });
  const expectedRevision = input.recordRevision ?? input.expectedRecordRevision;
  if (expectedRevision !== undefined && expectedRevision !== targetDetails.recordRevision) {
    throw new RecordChangedError(currentSummary);
  }
  const rawTitle = input.title !== undefined ? input.title : input.text;
  const rawDetails = input.details_markdown !== undefined ? input.details_markdown : input.detailsMarkdown;
  const titleProvided = rawTitle !== undefined;
  const detailsProvided = rawDetails !== undefined;
  const needsProvided = input.needs !== undefined;
  const taskIdProvided = input.taskId !== undefined;
  const attachmentsProvided = input.appendAttachments !== undefined && input.appendAttachments.length > 0;
  if (!titleProvided && !detailsProvided && !needsProvided && !taskIdProvided && !attachmentsProvided) {
    throw new Error('INVALID_ARGUMENTS：至少需要提供一项要修改的字段');
  }
  if (titleProvided && (rawTitle!.includes('\n') || rawTitle!.includes('\r'))) {
    throw new Error('INVALID_ARGUMENTS：想法标题不能包含换行');
  }
  const nextTitle = titleProvided ? rawTitle! : idea.text;
  const nextDetails = detailsProvided ? normalizeBody(rawDetails!) : targetDetails.body;
  const nextNeeds = needsProvided ? (input.needs?.trim() || null) : idea.needs;
  const nextTaskId = taskIdProvided ? input.taskId! : idea.task_id;
  const nextAttachments = attachmentsProvided
    ? Array.from(new Set([...idea.attachments, ...input.appendAttachments!]))
    : idea.attachments;
  if (!nextTitle.trim() && !nextDetails.trim() && nextAttachments.length === 0) {
    throw new Error('想法内容或附件不能为空');
  }
  const titleChanged = nextTitle !== idea.text;
  const detailsChanged = nextDetails !== targetDetails.body;
  const needsChanged = nextNeeds !== idea.needs;
  const taskIdChanged = nextTaskId !== idea.task_id;
  const attachmentsChanged =
    nextAttachments.length !== idea.attachments.length ||
    nextAttachments.some((item, idx) => item !== idea.attachments[idx]);
  if (!titleChanged && !detailsChanged && !needsChanged && !taskIdChanged && !attachmentsChanged) {
    const doc = toIdeaDocument(idea, {
      hasDetails: targetDetails.hasDetails,
      recordRevision: targetDetails.recordRevision,
      detailsMarkdown: targetDetails.body,
    });
    return { record: idea, idea: currentSummary, document: doc, noop: true };
  }
  const nextTags = (titleChanged || detailsChanged)
    ? extractRecordTags(nextTitle, nextDetails)
    : idea.tags;
  const updated: RecordEntry = {
    ...idea,
    text: nextTitle,
    tags: nextTags,
    needs: nextNeeds,
    task_id: nextTaskId,
    attachments: nextAttachments,
    last_touched_at: tx.at,
  };
  tx.saveRecord(updated, detailsChanged ? nextDetails : undefined);
  const nextRevision = computeRecordRevision({
    id: updated.id,
    text: updated.text,
    details_markdown: nextDetails,
    needs: updated.needs,
    tags: updated.tags,
    attachments: updated.attachments,
  });
  const hasDetails = nextDetails.length > 0;
  const summary = toIdeaSummary(updated, {
    hasDetails,
    recordRevision: nextRevision,
  });
  const doc = toIdeaDocument(updated, {
    hasDetails,
    recordRevision: nextRevision,
    detailsMarkdown: nextDetails,
  });
  return {
    record: updated,
    idea: summary,
    document: doc,
    noop: false,
  };
}

export const updateIdea = (
  ctx: Ctx,
  input: UpdateIdeaServiceInput,
  at?: string,
  source?: HistorySource,
) =>
  run(
    ctx,
    async tx => (await updateIdeaInTx(tx, input)).document,
    at,
    { action: 'idea.edit', subject: { type: 'record', id: input.id }, ...(source ? { source } : {}) },
  );

export type IdeaTaskInput = {
  items: (string | TaskItemDraft)[];
  recordRevision?: string;
} & ({ taskId: string } | { name: string; slot: BackpackSlot; defaultProject: string | null });

export function convertIdeaInTx(
  tx: Transaction,
  id: string,
  input: IdeaTaskInput,
  options?: { validateProject?: boolean },
): string[] {
  const idea = findIdea(tx, id);
  if (input.recordRevision !== undefined) {
    const currentSummary = ideaSummaryInTx(tx, idea);
    if (input.recordRevision !== currentSummary.record_revision) {
      throw new RecordChangedError(currentSummary);
    }
  }
  if (idea.pool === '已转任务' || idea.card_id !== null || tx.cards.some(card => card.id === `card-${id}`)) {
    throw new Error('IDEA_ALREADY_CONVERTED：这个想法已经转为待办');
  }
  const normalizedItems: TaskItemDraft[] = input.items.map(item =>
    typeof item === 'string'
      ? { content: item, type: '结果卡', minutes: null }
      : item,
  );
  if (!normalizedItems.length || normalizedItems.some(item => !item.content.trim())) {
    throw new Error('INVALID_ARGUMENTS：待办内容不能为空');
  }
  for (const item of normalizedItems) {
    if (item.type === '时间盒卡' && !(item.minutes !== null && Number.isInteger(item.minutes) && item.minutes > 0)) {
      throw new Error('INVALID_ARGUMENTS：时间盒要填正整数分钟');
    }
    if (item.type === '结果卡' && item.minutes !== null) {
      throw new Error('INVALID_ARGUMENTS：结果卡不能填写分钟数');
    }
  }
  let taskId: string;
  if ('taskId' in input) {
    const task = tx.tasks.find(task => task.id === input.taskId);
    if (!task) throw new Error('TASK_NOT_FOUND：任务不存在');
    if (!inBackpack(task)) throw new Error('TASK_NOT_IN_BACKPACK：任务不在任务池');
    const activeCount = tx.cards.filter(c => c.task_id === task.id && (c.status === '待做' || c.status === '进行中')).length;
    if (task.slot === '主线' && itemCapacity(task, tx.cards, tx.settings) < normalizedItems.length) {
      throw new MainTaskItemsFullError(task.id, tx.settings.mainItems, activeCount, normalizedItems.length);
    }
    taskId = task.id;
  } else {
    const defaultProject = input.defaultProject?.trim() || null;
    if (
      options?.validateProject &&
      defaultProject !== null &&
      defaultProject !== '未分类' &&
      !tx.settings.lists.projects.some(p => p.name === defaultProject)
    ) {
      throw new Error(`UNKNOWN_PROJECT：未知项目「${defaultProject}」，请从已有项目中选择`);
    }
    if (!canAddTask(tx.tasks, input.slot, tx.settings)) {
      const limit = input.slot === '主线' ? tx.settings.mainTasks : tx.settings.sideTasks;
      const activeTasks = tx.tasks
        .filter(t => inBackpack(t) && t.slot === input.slot)
        .sort((a, b) => (a.slot_index ?? 0) - (b.slot_index ?? 0) || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))
        .map(t => ({ id: t.id, name: t.name }));
      throw new TaskCapacityFullError(input.slot, limit, activeTasks);
    }
    if (input.slot === '主线' && normalizedItems.length > tx.settings.mainItems) {
      throw new MainTaskItemsFullError('new_task', tx.settings.mainItems, 0, normalizedItems.length);
    }
    const { task } = taskWithItems({ ...input, makeRoom: null, items: undefined }, tx.tasks, tx.cards, tx.settings, tx.at, tx.id);
    if (normalizedItems.length > itemCapacity(task, tx.cards, tx.settings)) {
      throw new MainTaskItemsFullError(task.id, tx.settings.mainItems, 0, normalizedItems.length);
    }
    tx.saveTask(task);
    taskId = task.id;
  }
  const order = Math.max(0, ...tx.cards.map(item => item.order));
  const cards = normalizedItems.map((item, index) => ({
    ...convert({ ...idea, kind: '待办', text: item.content.trim(), task_id: taskId, created_at: tx.at }, order + index + 1),
    id: index === 0 ? `card-${id}` : tx.id(),
    type: item.type,
    timebox_minutes: item.type === '时间盒卡' ? item.minutes : null,
  }));
  cards.forEach(card => tx.saveCard(card));
  tx.saveRecord({ ...clearDone(idea), pool: '已转任务', card_id: cards[0].id, last_touched_at: tx.at, cold_since: null });
  refreshInTx(tx);
  return cards.map(card => card.id);
}
export const convertIdeaToTask = (ctx: Ctx, id: string, input: IdeaTaskInput, at: string) => run(ctx, async tx => convertIdeaInTx(tx, id, input), at, { action: 'idea.convertToTask' });
export const convertIdea = (ctx: Ctx, id: string, input: { content: string; taskId: string | null }, at: string) => run(ctx, async tx => {
  const target = input.taskId === null ? { name: input.content, slot: '支线' as const, defaultProject: null } : { taskId: input.taskId };
  return convertIdeaInTx(tx, id, { ...target, items: [input.content] })[0];
}, at, { action: 'idea.convert' });

export const deleteIdea = (ctx: Ctx, id: string, at: string) => run(ctx, async tx => {
  findIdea(tx, id); tx.removeRecord(id);
}, at, { action: 'idea.delete' });

export const editIdea = (
  ctx: Ctx,
  id: string,
  input: { text?: string; title?: string; details?: string; needs?: string | null; baseRevision?: string },
  at: string,
  source?: HistorySource,
) => run(ctx, async tx => {
  return updateIdeaInTx(tx, {
    id,
    recordRevision: input.baseRevision,
    ...(input.title !== undefined || input.text !== undefined ? { title: input.title ?? input.text } : {}),
    ...(input.details !== undefined ? { details_markdown: input.details } : {}),
    ...(input.needs !== undefined ? { needs: input.needs } : {}),
  });
}, at, { action: 'idea.edit', subject: { type: 'record', id }, ...(source ? { source } : {}) });

/** 谁标的完成（ADR 0020 第 1 条）：取这次操作的历史来源；没给来源的是主窗口手动。 */
export function completedBy(source: HistorySource | undefined): IdeaCompletedBy {
  if (!source || source.kind === 'manual' || source.kind === 'system') return { kind: 'manual', agent: null };
  return { kind: source.kind, agent: source.agent.name ?? null };
}
/** 完成一个想法；本来就已完成的返回 noop（MCP / CLI 重复标记不报错，ADR 0020 第 4 条）。 */
export function completeIdeaInTx(tx: Transaction, id: string, by: IdeaCompletedBy): { record: RecordEntry; noop: boolean } {
  const idea = findIdea(tx, id);
  if (ideaStatus(idea) === '已完成') return { record: idea, noop: true };
  const done = completeIdea(idea, tx.at, by);
  tx.saveRecord(done);
  return { record: done, noop: false };
}
export const complete = (ctx: Ctx, id: string, at: string) => run(ctx, async tx => { completeIdeaInTx(tx, id, completedBy(undefined)); }, at,
  { action: 'idea.complete', subject: { type: 'record', id } });
/** 撤销完成一个想法；已经在活跃池的返回 noop（已转任务或冷库仍按 uncompleteIdea 规则报错，ADR 0020 / ADR 0023 §4）。 */
export function uncompleteIdeaInTx(tx: Transaction, id: string): { record: RecordEntry; noop: boolean } {
  const idea = findIdea(tx, id);
  if (ideaStatus(idea) === '活跃池') return { record: idea, noop: true };
  const reopened = uncompleteIdea(idea, tx.at);
  tx.saveRecord(reopened);
  return { record: reopened, noop: false };
}
export const uncomplete = (ctx: Ctx, id: string, at: string) => run(ctx, async tx => {
  tx.saveRecord(uncompleteIdea(findIdea(tx, id), tx.at));
}, at, { action: 'idea.uncomplete', subject: { type: 'record', id } });

export function expireInTx(tx: Transaction): number {
  const expired = expiredIdeas(tx.records, tx.at, tx.settings.ideaExpireDays);
  expired.forEach(idea => tx.saveRecord(idea));
  return expired.length;
}
// 后台：到期进冷库是按规则自己做的（平时由 newDay 一并处理），来源记「系统 · 活动日切换」
export const expire = (ctx: Ctx, at: string) =>
  run(ctx, async tx => expireInTx(tx), at, { action: 'idea.expire', source: { kind: 'system', trigger: 'dayChange' } });

export type ReviveResult = { kind: 'restored' } | ({ kind: 'duel' } & Duel);
export function reviveInTx(tx: Transaction, ids: string[], confirmed = false): ReviveResult {
  const at = tx.at;
  if (ids.length === 0 || new Set(ids).size !== ids.length) throw new Error('请选择不同的冷库想法');
  const ideas = ids.map(id => findIdea(tx, id));
  if (ideas.some(idea => ideaStatus(idea) === '已完成')) throw new Error('想法已完成，请先在「已完成」里撤销完成');
  if (ideas.some(idea => idea.pool !== '冷库')) throw new Error('想法不在冷库');
  const active = activeIdeas(tx.records), free = tx.settings.ideaPoolLimit - active.length;
  if (free >= ids.length) {
    ideas.forEach(idea => tx.saveRecord(reviveIdea(idea, at)));
    return { kind: 'restored' };
  }
  if (free > 0) throw new Error('捞回数量超过池中空位');
  if (!confirmed) throw new Error('想法池已满，请确认后捞回并对决');
  if (ids.length !== 1) throw new Error('池满时一次只能捞回一个想法');
  const opponent = weakest(active);
  if (!opponent) throw new Error('没有可对决的池中想法');
  // Keep it cold until a winner is explicitly chosen; a cancelled dialog changes nothing.
  return { kind: 'duel', left: ideas[0], right: opponent };
}
export const revive = (ctx: Ctx, ids: string[], at: string, confirmed = false): Promise<ReviveResult> => run(ctx, async tx => reviveInTx(tx, ids, confirmed), at, { action: 'idea.revive' });

export function resolveDuelInTx(tx: Transaction, winnerId: string, loserId: string): void {
  const at = tx.at;
  const winner = findIdea(tx, winnerId), loser = findIdea(tx, loserId);
  if ([winner, loser].some(idea => ideaStatus(idea) === '已完成')) throw new Error('已完成的想法不参加对决');
  const cold = [winner, loser].filter(idea => idea.pool === '冷库');
  if (cold.length) {
    if (activeIdeas(tx.records).length < tx.settings.ideaPoolLimit) throw new Error('池中已有空位，请重新直接捞回');
    const opponent = cold[0].id === winner.id ? loser : winner;
    if (cold.length !== 1 || weakest(tx.records)?.id !== opponent.id) throw new Error('冷库对决对手已改变，请重新选择');
    const changed = decide(winner.pool === '冷库' ? reviveIdea(winner, at) : winner,
      loser.pool === '冷库' ? reviveIdea(loser, at) : loser, at);
    changed.forEach(idea => tx.saveRecord(idea));
    return;
  }
  const duel = pair(tx.records, tx.settings.ideaPoolLimit);
  if (!duel || ![duel.left.id, duel.right.id].every(id => id === winnerId || id === loserId)) throw new Error('对决配对已改变');
  decide(winner, loser, at).forEach(idea => tx.saveRecord(idea));
}
export const resolveDuel = (ctx: Ctx, winnerId: string, loserId: string, at: string) => run(ctx, async tx => resolveDuelInTx(tx, winnerId, loserId), at, { action: 'idea.resolveDuel' });

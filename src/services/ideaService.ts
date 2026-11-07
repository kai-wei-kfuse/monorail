import type { RecordEntry } from '../domain/record/record';
import { extractTags } from '../domain/record/record';
import { convert } from '../domain/record/convert';
import { activeIdeas, clearDone, completeIdea, ideaStatus, requireIdea, reviveIdea, uncompleteIdea, weakest, expiredIdeas } from '../domain/idea/pool';
import type { IdeaCompletedBy } from '../domain/record/record';
import type { HistorySource } from '../shared/history';
import { decide, pair } from '../domain/idea/arena';
import type { Duel } from '../domain/idea/arena';
import type { Ctx, Transaction } from './commit';
import { run } from './commit';
import { refreshInTx } from './dealService';
import { taskWithItems } from '../domain/task/create';
import { itemCapacity } from '../domain/task/pool';
import { inBackpack } from '../domain/task/task';
import type { BackpackSlot } from '../shared/backpack';

function findIdea(tx: Transaction, id: string): RecordEntry {
  const record = tx.records.find(item => item.id === id);
  if (!record) throw new Error('想法不存在');
  requireIdea(record);
  return record;
}

export type IdeaTaskInput = { items: string[] } & ({ taskId: string } | { name: string; slot: BackpackSlot; defaultProject: string | null });
function convertIdeaInTx(tx: Transaction, id: string, input: IdeaTaskInput): string[] {
  const idea = findIdea(tx, id);
  if (idea.pool === '已转任务' || idea.card_id !== null || tx.cards.some(card => card.id === `card-${id}`)) throw new Error('这个想法已经转为待办');
  if (!input.items.length || input.items.some(content => !content.trim())) throw new Error('待办内容不能为空');
  let taskId: string;
  if ('taskId' in input) {
    const task = tx.tasks.find(task => task.id === input.taskId);
    if (!task || !inBackpack(task)) throw new Error('任务不在任务池');
    if (itemCapacity(task, tx.cards, tx.settings) < input.items.length) throw new Error('主线任务事项已满');
    taskId = task.id;
  } else {
    const { task } = taskWithItems({ ...input, makeRoom: null, items: undefined }, tx.tasks, tx.cards, tx.settings, tx.at, tx.id);
    if (input.items.length > itemCapacity(task, tx.cards, tx.settings)) throw new Error('主线任务事项已满');
    tx.saveTask(task); taskId = task.id;
  }
  const order = Math.max(0, ...tx.cards.map(item => item.order));
  const cards = input.items.map((content, index) => ({
    ...convert({ ...idea, kind: '待办', text: content.trim(), task_id: taskId, created_at: tx.at }, order + index + 1),
    id: index === 0 ? `card-${id}` : tx.id(),
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

export const editIdea = (ctx: Ctx, id: string, input: { text: string; needs: string | null }, at: string) => run(ctx, async tx => {
  const idea = findIdea(tx, id);
  if (!input.text.trim() && idea.attachments.length === 0) throw new Error('想法内容或附件不能为空');
  tx.saveRecord({ ...idea, text: input.text, tags: extractTags(input.text), needs: input.needs?.trim() || null, last_touched_at: at });
}, at, { action: 'idea.edit' });

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

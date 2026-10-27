import type { Project } from '../domain/project/project';
import { inBackpack, trackOf } from '../domain/project/project';
import { putInBackpack, leaveBackpack } from '../domain/project/backpack';
import { createCard, editCard } from '../domain/card/edit';
import { releaseCard } from '../domain/card/transitions';
import type { BackpackSlot, CardFields, MakeRoom, ProjectDraft } from '../shared/backpack';
import type { Ctx, Transaction } from './commit';
import { run } from './commit';
import { refreshInTx } from './dealService';
import { openSegmentInTx, switchInTx, idleTarget } from './timerService';

function findProject(tx: Transaction, id: string): Project {
  const project = tx.projects.find(item => item.id === id);
  if (!project) throw new Error('项目不存在');
  return project;
}

async function removeProjectInTx(tx: Transaction, id: string, status: '冷藏' | '已放弃'): Promise<void> {
  const project = findProject(tx, id), current = openSegmentInTx(tx);
  tx.saveProject(leaveBackpack(project, status));
  for (const card of tx.cards.filter(item => item.project_id === id)) {
    if (status === '已放弃' && card.status !== '已完成' && card.status !== '已放弃') tx.saveCard({ ...card, status: '已放弃' });
    else if (status === '冷藏' && card.status === '进行中') tx.saveCard(releaseCard(card));
    if (tx.state.current_card === card.id) tx.state.current_card = null;
  }
  // A3: an inserted activity continues; resume checks the released/abandoned card later.
  if (current?.card_id && tx.cards.some(card => card.id === current.card_id && card.project_id === id)) await switchInTx(tx, tx.at, idleTarget(tx));
}

async function makeRoomInTx(tx: Transaction, slot: Project['slot'], room: MakeRoom | null | undefined): Promise<void> {
  if (!room) return;
  const project = findProject(tx, room.id);
  if (slot === '不在背包' || !inBackpack(project) || project.slot !== slot) throw new Error('腾位项目必须在目标类型的背包格内');
  await removeProjectInTx(tx, room.id, room.action === '放弃' ? '已放弃' : '冷藏');
}

export const createProject = (ctx: Ctx, draft: ProjectDraft, at: string) => run(ctx, async tx => {
  if (!draft.name.trim()) throw new Error('项目名不能为空');
  await makeRoomInTx(tx, draft.slot, draft.makeRoom);
  let project: Project = { id: tx.id(), name: draft.name.trim(), slot: '不在背包', slot_index: null, status: '进行中', created_at: at, bet_ends_at: null };
  if (draft.slot !== '不在背包') project = putInBackpack(project, draft.slot, tx.projects, tx.settings, at);
  tx.saveProject(project); refreshInTx(tx);
  return project.id;
}, at);

export const freezeProject = (ctx: Ctx, id: string, at: string) => run(ctx, async tx => {
  await removeProjectInTx(tx, id, '冷藏'); refreshInTx(tx);
}, at);
export const abandonProject = (ctx: Ctx, id: string, at: string) => run(ctx, async tx => {
  await removeProjectInTx(tx, id, '已放弃'); refreshInTx(tx);
}, at);
export const restoreProject = (ctx: Ctx, id: string, slot: BackpackSlot, at: string, makeRoom?: MakeRoom) => run(ctx, async tx => {
  const project = findProject(tx, id);
  if (makeRoom?.id === id) throw new Error('不能用当前项目给自己腾位');
  await makeRoomInTx(tx, slot, makeRoom);
  tx.saveProject(putInBackpack(project, slot, tx.projects, tx.settings, at)); refreshInTx(tx);
}, at);

export const saveCard = (ctx: Ctx, cardId: string | null, fields: CardFields, at: string) => run(ctx, async tx => {
  if (fields.projectId !== null) findProject(tx, fields.projectId);
  const original = cardId === null ? null : tx.cards.find(card => card.id === cardId);
  if (cardId !== null && !original) throw new Error('卡片不存在');
  if (original && original.status !== '待做' && original.status !== '进行中') throw new Error('只能编辑待做或进行中的卡');
  let card = original ? editCard(original, fields) : createCard(tx.id(), fields, at, Math.max(0, ...tx.cards.map(item => item.order)) + 1);
  const project = tx.projects.find(item => item.id === card.project_id), current = openSegmentInTx(tx);
  const eligible = card.project_id === null || (!!project && inBackpack(project));
  if (!eligible) {
    card = releaseCard(card);
    if (tx.state.current_card === card.id) tx.state.current_card = null;
  }
  tx.saveCard(card);
  if (current?.card_id === card.id) {
    const category = trackOf(card.project_id, tx.projects);
    if (!eligible) await switchInTx(tx, at, idleTarget(tx));
    else if (current.activity !== card.content || current.category !== category) await switchInTx(tx, at,
      { activity: card.content, category, card_id: card.id, kind: '普通', resume_card_id: null });
  }
  refreshInTx(tx);
  return card.id;
}, at);

export const reorderQueue = (ctx: Ctx, projectId: string | null, cardIds: string[], at: string) => run(ctx, async tx => {
  if (projectId !== null) findProject(tx, projectId);
  const cards = tx.cards.filter(card => card.project_id === projectId && (card.status === '待做' || card.status === '进行中'));
  if (cardIds.length !== cards.length || new Set(cardIds).size !== cardIds.length || cards.some(card => !cardIds.includes(card.id))) throw new Error('队列已改变，请提交当前队列的完整顺序');
  const ordered = [...tx.cards].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  let index = 0;
  // Reassign ranks in the existing global sequence, replacing only this queue's positions.
  // This also makes ties in imported ranks reorderable without moving other projects.
  const replacements = cardIds.map(id => cards.find(card => card.id === id)!);
  ordered.map(card => cardIds.includes(card.id) ? replacements[index++] : card)
    .forEach((card, rank) => { if (card.order !== rank + 1) tx.saveCard({ ...card, order: rank + 1 }); });
  refreshInTx(tx);
}, at);

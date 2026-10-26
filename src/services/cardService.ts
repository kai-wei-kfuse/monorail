import { activityDay } from '../domain/timeline/day';
import type { Ctx } from './commit';
import { run } from './commit';
import { switchInTx } from './timerService';

export async function start(ctx: Ctx, cardId: string, at: string): Promise<void> {
  return run(ctx, async tx => {
    const entity = await tx.repos.cards.get(cardId);
    if (!entity || entity.value.status === '已完成') throw new Error('卡片不存在或已经完成');
    const current = tx.segments.find(s => s.id === tx.state.open_segment && s.ended_at === null);
    if (current?.card_id === cardId && entity.value.status === '进行中') return;
    if (current?.card_id && current.card_id !== cardId) throw new Error('另一个任务正在进行');
    tx.writes.push(await tx.repos.cards.write({ ...entity.value, status: '进行中' }, entity));
    await switchInTx(tx, at, { activity: entity.value.content, category: '支线', card_id: cardId, kind: '普通', resume_card_id: null });
    tx.state.current_card = cardId;
  }, at);
}

export async function complete(ctx: Ctx, cardId: string, at: string, note: string): Promise<void> {
  return run(ctx, async tx => {
    const entity = await tx.repos.cards.get(cardId);
    if (!entity) throw new Error('卡片不存在');
    if (entity.value.status === '已完成') return;
    if (entity.value.status !== '进行中' || tx.state.current_card !== cardId) throw new Error('卡片尚未开始');
    tx.writes.push(await tx.repos.cards.write({ ...entity.value, status: '已完成', completed_at: at,
      completed_day: activityDay(at, tx.settings.dayBoundaryHour), completed_track: '支线', progress_note: note }, entity));
    await switchInTx(tx, at, { activity: tx.settings.lists.idleName, category: '待机', card_id: null, kind: '普通', resume_card_id: null });
    tx.state.current_card = null;
  }, at);
}

import { closeSegment } from '../domain/timeline/segment';
import type { Segment } from '../domain/timeline/segment';
import { activityDay, splitAtDays } from '../domain/timeline/day';
import type { Ctx, Transaction } from './commit';
import { run } from './commit';

export async function switchInTx(tx: Transaction, at: string, target: Pick<Segment, 'activity' | 'category' | 'card_id' | 'kind' | 'resume_card_id'>) {
  const changes: { day: string; segment: Segment }[] = [];
  if (tx.state.open_segment) {
    const previous = tx.segments.find(s => s.id === tx.state.open_segment && s.ended_at === null);
    if (!previous) throw new Error('当前计时段不存在');
    const closed = closeSegment(previous, at);
    const pieces = splitAtDays(closed.started_at, at, tx.settings.dayBoundaryHour);
    if (!pieces.length) changes.push({ day: tx.state.open_segment_day!, segment: closed });
    else pieces.forEach((part, index) => changes.push({ day: index === 0 ? tx.state.open_segment_day! : part.day, segment: {
      ...closed, started_at: index === 0 ? closed.started_at : part.start, ended_at: part.end,
    } }));
  }
  const next: Segment = { ...target, id: tx.id(), seq: tx.nextSeq(), started_at: at, ended_at: null, source: '手动' };
  const day = activityDay(at, tx.settings.dayBoundaryHour);
  changes.push({ day, segment: next });
  tx.writes.push(...await tx.repos.times.writes(changes));
  tx.state.open_segment = next.id;
  tx.state.open_segment_day = day;
}

export async function insert(ctx: Ctx, activity: string, at: string) {
  return run(ctx, tx => switchInTx(tx, at, { activity, category: '生活', card_id: null, kind: '插入', resume_card_id: tx.state.current_card }), at);
}

export async function resume(ctx: Ctx, at: string) {
  return run(ctx, async tx => {
    const current = tx.segments.find(s => s.id === tx.state.open_segment && s.ended_at === null);
    if (!current || current.kind !== '插入') throw new Error('没有插入活动');
    const card = current.resume_card_id ? await tx.repos.cards.get(current.resume_card_id) : null;
    await switchInTx(tx, at, { activity: card?.value.content ?? tx.settings.lists.idleName, category: card ? '支线' : '待机', card_id: card?.value.id ?? null, kind: '普通', resume_card_id: null });
  }, at);
}

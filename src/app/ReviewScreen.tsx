import { useEffect, useState } from 'react';
import { useStore } from 'zustand';
import { appStore } from '../store/appStore';
import { ReviewDonePage, ReviewPage } from '../pages/review/ReviewPage';
import type { ReviewActions } from '../pages/review/ReviewPage';
import { RecapBoard } from '../pages/review/recap/RecapBoard';
import type { Ctx } from '../services/commit';
import * as review from '../services/reviewService';
import { useRecap } from './useRecap';

/**
 * Wires the weekly review page to store.review and reviewService. Errors surface through `report`.
 * Mounting the page opens or resumes review progress without changing the current timer.
 * store.review === null after entering means this period's review is done (or nothing is in progress).
 */
export function ReviewScreen({ ctx, report }: { ctx: Ctx; report: (error: unknown) => void }) {
  const data = useStore(appStore, state => state.review);
  const tasks = useStore(appStore, state => state.backpack.tasks);
  const [entered, setEntered] = useState(false);
  const call = (work: () => Promise<unknown>) => { void work().catch(report); };
  const board = <RecapBoard {...useRecap(ctx, report)} />;
  // 最近一次完成回顾的时刻（没有完成过就是 null）；不用 recapStart，它在没完成过时会退回首次使用日
  const completedAt = (ctx.snapshot()?.reviews ?? []).filter(r => r.status === '已完成' && r.completed_at)
    .map(r => r.completed_at!).sort().at(-1) ?? null;

  useEffect(() => {
    void review.enter(ctx, new Date().toISOString()).catch(report).finally(() => setEntered(true));
    // 只在进入页面时恢复回顾进度，不控制计时
  }, [ctx]);

  const actions: ReviewActions = {
    goto: (step, at) => call(() => review.goto(ctx, step, at)),
    addIdea: (text, at) => call(() => review.addIdea(ctx, text, at)),
    duel: (winnerId, loserId, at) => call(() => review.duel(ctx, winnerId, loserId, at)),
    // 池满时 ColdPick 已经让用户确认过「捞回并对决」，所以 confirmed 跟着池子是否已满走
    takeCold: (ids, at) => call(() => review.takeCold(ctx, ids, at, (data?.cold.poolFree ?? 0) <= 0)),
    skipCold: at => call(() => review.skipCold(ctx, at)),
    continueBet: at => call(() => review.continueBet(ctx, at)),
    switchMain: (draft, at) => call(() => review.switchMain(ctx, draft, at)),
    finish: at => call(() => review.finish(ctx, at)),
  };

  if (!entered) return <div className="rv-empty"><p>正在打开回顾…</p></div>;
  // 本期回顾已完成（或没有进行中的回顾）：回看照样能看（0.3.0-beta.3 D7）
  if (!data) return <ReviewDonePage completedAt={completedAt} recap={board} />;
  const parked = tasks.filter(p => p.status === '冷藏' || (p.status === '进行中' && p.slot === '不在背包')).map(p => ({ id: p.id, name: p.name }));
  return <ReviewPage data={data} actions={actions} parked={parked} recap={board} />;
}

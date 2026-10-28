// 用户动作的适配层：所有「界面回调 → service」的调用都集中在这里。service 改签名时只改这一个文件。
// 每个动作都带点击时刻 at（架构 §5.1）；出错统一交给 report，不在页面里各自 try/catch。
import { invoke } from '@tauri-apps/api/core';
import type { Ctx } from '../services/commit';
import * as card from '../services/cardService';
import type { ShrinkCommand } from '../services/cardService';
import * as timer from '../services/timerService';
import { returnFromRest } from '../services/degradeService';
import { changeLists } from '../services/settingsService';
import type { BackfillResult } from '../shared/notices';

export type Actions = ReturnType<typeof createActions>;

export function createActions(ctx: Ctx, report: (error: unknown) => void) {
  const guard = <A extends unknown[], R>(fn: (...args: A) => Promise<R>) => async (...args: A): Promise<R | undefined> => {
    try { return await fn(...args); } catch (error) { report(error); return undefined; }
  };
  return {
    // 卡片（cardService）
    start: guard((cardId: string, at: string) => card.start(ctx, cardId, at)),
    checkComplete: guard((cardId: string, at: string) => card.checkComplete(ctx, cardId, at)),
    complete: guard((cardId: string, at: string, note: string, keepGoing: boolean) => card.complete(ctx, cardId, at, note, keepGoing)),
    shrink: guard((cardId: string, input: ShrinkCommand, at: string) => card.shrink(ctx, cardId, input, at)),
    redraw: guard((cardId: string | null, at: string) => card.redraw(ctx, cardId, at)),
    pass: guard((cardId: string, at: string) => card.pass(ctx, cardId, at)),
    stopToday: guard((at: string) => card.stopToday(ctx, at)),
    // 计时（timerService）。activity 是快捷活动的 id，或者手写的活动名
    insert: guard((activity: string, at: string) => timer.insert(ctx, activity, at)),
    resume: guard((at: string) => timer.resume(ctx, at)),
    // 临时活动：手写的名字直接插入（项目默认「生活」）。和已有快捷活动同名就用那一项；勾了「存为快捷活动」先写进列表
    tempActivity: guard(async (name: string, keep: boolean, at: string) => {
      const list = ctx.settings.lists.quickActivities, same = list.find(a => a.name === name);
      if (keep && !same) await changeLists(ctx, { quickActivities: [...list, { id: crypto.randomUUID(), name, category: '生活' }] }, at);
      await timer.insert(ctx, same?.id ?? name, at);
    }),
    backfill: guard(async (r: BackfillResult): Promise<void> => { await (r.mode === 'since'
      ? timer.backfillSwitch(ctx, r.minutesAgo, r.activity, r.at)
      : timer.backfillRange(ctx, { start: r.from, end: r.to }, r.activity, r.at)); }),
    sleep: guard((at: string) => timer.sleep(ctx, at)),
    wake: guard((at: string) => timer.wake(ctx, at)),
    answerOffline: guard((from: string, to: string, activity: string, at: string) => timer.answerOffline(ctx, { start: from, end: to }, activity, at)),
    // 降级（degradeService）
    returnFromRest: guard((answer: string, at: string) => returnFromRest(ctx, answer, at)),
    // 窗口
    showQuickbar: guard(() => invoke('show_quickbar')),
  };
}

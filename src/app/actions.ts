// 用户动作的适配层：所有「界面回调 → service」的调用都集中在这里。service 改签名时只改这一个文件。
// 每个动作都带点击时刻 at（架构 §5.1）；出错统一交给 report，不在页面里各自 try/catch。
import { invoke } from '@tauri-apps/api/core';
import type { Ctx } from '../services/commit';
import * as card from '../services/cardService';
import type { ShrinkCommand } from '../services/cardService';
import * as timer from '../services/homeService';
import * as preset from '../services/presetService';
import { returnFromRest } from '../services/degradeService';
import { changeLists } from '../services/settingsService';
import type { BackfillResult } from '../shared/notices';
import type { EntryValue } from '../pages/home/TimerBar';
import type { ReadoutOutcome, ReadoutRequest } from '../pages/home/TimeField';

export type Actions = ReturnType<typeof createActions>;

export function createActions(ctx: Ctx, report: (error: unknown) => void) {
  const guard = <A extends unknown[], R>(fn: (...args: A) => Promise<R>) => async (...args: A): Promise<R | undefined> => {
    try { return await fn(...args); } catch (error) { report(error); return undefined; }
  };
  return {
    // 卡片（cardService）
    start: guard((cardId: string, at: string) => timer.startCard(ctx, cardId, at)),
    checkComplete: guard((cardId: string, at: string) => card.checkComplete(ctx, cardId, at)),
    complete: guard((cardId: string, at: string, note: string, keepGoing: boolean) => card.complete(ctx, cardId, at, note, keepGoing)),
    shrink: guard((cardId: string, input: ShrinkCommand, at: string) => card.shrink(ctx, cardId, input, at)),
    redraw: guard((cardId: string | null, at: string) => card.redraw(ctx, cardId, at)),
    pass: guard((cardId: string, at: string) => card.pass(ctx, cardId, at)),
    editContent: guard((cardId: string, content: string, at: string) => card.editContent(ctx, cardId, content, at)),
    // 卡头「记到」那一行：project 为 null 是跟随任务的默认项目
    editMeta: guard((cardId: string, project: string | null, tags: string[], at: string) => timer.editMeta(ctx, cardId, project, tags, at)),
    draw: guard((at: string) => timer.draw(ctx, at)),
    // 计时条（homeService，N3 接线草案）
    beginPending: guard((at: string) => timer.beginPending(ctx, at)),
    cancelPending: guard((pendingId: string, at: string) => timer.cancelPending(ctx, pendingId, at)),
    startFree: guard((value: EntryValue, at: string) => timer.startFree(ctx, value, at)),
    editOpen: guard((entryId: string, patch: Partial<EntryValue>, at: string) => timer.editOpen(ctx, entryId, patch, at)),
    pause: guard((at: string) => timer.pause(ctx, at)),
    continueEntry: guard((entryId: string, at: string) => timer.continueEntry(ctx, entryId, at)),
    // 读数：出错不弹报错，交回读数下面那一行显示；plan 原样带回
    commitReadout: async (req: ReadoutRequest, seen: unknown): Promise<ReadoutOutcome> => {
      try { return await timer.commitReadout(ctx, req, seen as Parameters<typeof timer.commitReadout>[2]); }
      catch (error) { return { kind: 'error', message: error instanceof Error ? error.message : String(error) }; }
    },
    // 手动补录：E1 共存；overlaps 是同步只读查询，只用来提示
    manual: guard((value: EntryValue, start: string, end: string, at: string) => timer.manual(ctx, value, start, end, at)),
    overlaps: (start: string, end: string) => timer.overlaps(ctx, start, end),
    // 收藏（presetService）：从计时条起点开始、把正在计的这条设为收藏、拖动排序
    startPreset: guard((presetId: string, at: string) => timer.startPreset(ctx, presetId, at)),
    favorite: guard((entryId: string, at: string) => preset.favorite(ctx, entryId, at)),
    reorderFavorites: guard((ids: string[], at: string) => preset.reorderFavorites(ctx, ids, at)),
    createProject: guard((name: string, at: string) => preset.createProject(ctx, name, at)),
    createTag: guard((tag: string, at: string) => {
      const tags = ctx.settings.lists.tags;
      return tags.includes(tag) ? Promise.resolve() : changeLists(ctx, { tags: [...tags, tag] }, at);
    }),
    // 计时（timerService）。activity 是快捷活动的 id，或者手写的活动名
    insert: guard((activity: string, at: string) => timer.insert(ctx, activity, at)),
    resume: guard((at: string) => timer.resume(ctx, at)),
    // 临时活动：手写的名字直接插入（项目默认「生活」）。和已有快捷活动同名就用那一项；勾了「存为快捷活动」先写进列表
    tempActivity: guard(async (name: string, keep: boolean, at: string) => {
      const list = ctx.settings.lists.presets, same = list.find(a => a.name === name);
      if (keep && !same) await changeLists(ctx, { presets: [...list, { id: crypto.randomUUID(), name, project: '生活', tags: [], mode: '插入', place: '弹层' }] }, at);
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

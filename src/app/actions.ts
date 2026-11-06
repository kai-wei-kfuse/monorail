// 用户动作的适配层：所有「界面回调 → service」的调用都集中在这里。service 改签名时只改这一个文件。
// 每个动作都带点击时刻 at（架构 §5.1）；出错统一交给 report，不在页面里各自 try/catch。
import { invoke } from '@tauri-apps/api/core';
import type { Ctx } from '../services/commit';
import * as card from '../services/cardService';
import type { SplitCommand } from '../services/cardService';
import * as timer from '../services/homeService';
import * as preset from '../services/presetService';
import * as deal from '../services/dealService';
import * as plan from '../services/planService';
import { changeLists } from '../services/settingsService';
import type { BackfillResult } from '../shared/notices';
import type { HistorySource } from '../shared/history';
import type { EntryValue } from '../pages/home/TimerBar';
import type { ReadoutOutcome, ReadoutRequest } from '../pages/home/TimeField';

export type Actions = ReturnType<typeof createActions>;
/** 首页发起的列表设置改动（ADR 0019 第 5 条：缺省会按前缀记成设置页）。 */
const HOME: HistorySource = { kind: 'manual', via: 'main', page: 'home' };

export function createActions(ctx: Ctx, report: (error: unknown) => void) {
  const guard = <A extends unknown[], R>(fn: (...args: A) => Promise<R>) => async (...args: A): Promise<R | undefined> => {
    try { return await fn(...args); } catch (error) { report(error); return undefined; }
  };
  return {
    // 卡片（cardService）
    start: guard((cardId: string, at: string) => timer.startCard(ctx, cardId, at)),
    checkComplete: guard((cardId: string, at: string) => card.checkComplete(ctx, cardId, at)),
    checkSplit: guard((cardId: string, at: string) => card.checkSplit(ctx, cardId, at)),
    // fromMini：小窗点的完成、主窗口弹的对话框（两段式），历史来源记小窗
    complete: guard((cardId: string, at: string, note: string, keepGoing: boolean, fromMini?: boolean) =>
      card.complete(ctx, cardId, at, note, keepGoing, fromMini ? { kind: 'manual', via: 'mini' } : undefined)),
    split: guard((cardId: string, input: SplitCommand, at: string) => card.split(ctx, cardId, input, at)),
    pass: guard((cardId: string, at: string) => card.pass(ctx, cardId, at)),
    editContent: guard((cardId: string, content: string, at: string) => card.editContent(ctx, cardId, content, at)),
    // 卡头「记到」那一行：project 为 null 是跟随任务的默认项目
    editMeta: guard((cardId: string, project: string | null, tags: string[], at: string) => timer.editMeta(ctx, cardId, project, tags, at)),
    // 抽卡（ADR 0021 第 2 条）：只读，结果给翻卡；〔换一张〕写板子的 seen，〔开始〕走 start
    draw: guard((at: string) => deal.drawFromPlan(ctx, at)),
    skipCard: guard((cardId: string, at: string) => plan.skipCard(ctx, cardId, at)),
    // 计时条（homeService，N3 接线草案）
    beginPending: guard((at: string) => timer.beginPending(ctx, at)),
    cancelPending: guard((pendingId: string, at: string) => timer.cancelPending(ctx, pendingId, at)),
    startFree: guard((value: EntryValue, at: string) => timer.startFree(ctx, value, at)),
    editOpen: guard((entryId: string, patch: Partial<EntryValue>, at: string) => timer.editOpen(ctx, entryId, patch, at)),
    pause: guard((at: string) => timer.pause(ctx, at)),
    stop: guard((at: string) => timer.stop(ctx, at)),
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
      return tags.includes(tag) ? Promise.resolve() : changeLists(ctx, { tags: [...tags, tag] }, at, HOME);
    }),
    // 计时（timerService）。activity 是快捷活动的 id，或者手写的活动名
    insert: guard((activity: string, at: string) => timer.insert(ctx, activity, at)),
    /** 〔回来〕〔回到任务〕：回到原来那张卡 / 原来那件事 */
    resume: guard((at: string) => timer.resume(ctx, at)),
    /** 〔继续〕：插入的事暂停时继续插入的事；否则同原来的继续（卡暂停、自由记录暂停） */
    continueTimer: guard((at: string) => timer.continueTimer(ctx, at)),
    // 临时活动：手写的名字直接插入，项目用选的（缺省「未分类」，已定 62）。和已有快捷活动同名就用那一项；勾了「存为快捷活动」先按选的项目写进列表
    // 两次提交各记一条历史：改列表设置（来源首页）、插入临时活动
    tempActivity: guard(async (name: string, keep: boolean, at: string, project: string = '未分类') => {
      const list = ctx.settings.lists.presets, same = list.find(a => a.name === name);
      if (keep && !same) {
        const id = crypto.randomUUID();
        await changeLists(ctx, { presets: [...list, { id, name, project, tags: [], mode: '插入', place: '弹层' }] }, at, HOME);
        await timer.insert(ctx, id, at);
        return;
      }
      await timer.insert(ctx, same?.id ?? name, at, same ? undefined : project);
    }),
    backfill: guard(async (r: BackfillResult): Promise<void> => { await (r.mode === 'since'
      ? timer.backfillSwitch(ctx, r.minutesAgo, r.activity, r.at)
      : timer.backfillRange(ctx, { start: r.from, end: r.to }, r.activity, r.at)); }),
    wake: guard((at: string) => timer.wake(ctx, at)),
    answerOffline: guard((from: string, to: string, activity: string, at: string, project?: string) => timer.answerOffline(ctx, { start: from, end: to }, activity, at, project)),
    answerIdle: guard((entryId: string, activity: string, at: string, project?: string) => timer.answerIdle(ctx, entryId, activity, at, project)),
    // 主动休息（已定 48、55）：插入一条「休息」，回来就是〔回到任务〕
    rest: guard((at: string, project?: string) => timer.rest(ctx, at, project)),
    // 窗口
    showQuickbar: guard(() => invoke('show_quickbar')),
  };
}

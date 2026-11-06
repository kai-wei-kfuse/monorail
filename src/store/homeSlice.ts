export interface HomeCard {
  id: string; slotNo: string; slotOf: string; task: string;
  type: '结果卡' | '时间盒卡'; goalMinutes: number | null; content: string; progressNote: string;
  status: '待做' | '进行中';
  /** Resolved timing project, card tags, and whether the card explicitly overrides its task. */
  project: string; tags: string[]; projectOverridden: boolean;
}
export interface HomeSlice {
  mode: 'blank' | 'task' | 'guide' | 'rest' | 'review';
  entry: { id: string; description: string; project: string; tags: string[]; startedAt: string; cardId: string | null; paused: boolean; kind: '普通' | '插入' | '暂停' } | null;
  resumeEntry?: { id: string; description: string; project: string; tags: string[]; startedAt: string; endedAt: string | null; cardId: string | null; kind: '普通' | '插入' | '暂停' } | null;
  pending: { id: string; startedAt: string } | null;
  resumeDescription: string | null;
  knownTags: string[];
  guideKind: 'firstTask' | 'setMain' | 'splitMain' | 'allDone';
  card: HomeCard | null; closedEffectiveMs: number; currentSegStartedAt: string | null;
  /** 今天（当前活动日）这张卡已结束的那几段，和今天的量（板子上填的；不在板子上取时间盒的目标；结果卡为 null）（已定 23） */
  closedTodayMs: number; todayGoal: number | null;
  /** 开着那一段在今天的起点（跨夜时是今天活动日起点） */ todaySegStartedAt: string | null;
  awayActivity: string | null; baseline: { main: boolean | null; side: boolean };
  noMainHint: boolean; rest: { suggestion: string | null } | null;
  review: { period: string; resumeStep: string; betDue: boolean } | null;
  activity: { kind: 'idle' | 'focus' | 'away'; label: string; startedAt: string | null };
  /** 宽松模式下真正什么都没在做（不在插入、没有回到目标、开着的是待机）：首页写「没在计时」、读数不走（ADR 0021 第 13 条） */
  looseIdle: boolean;
  /**
   * 插入卡（ADR 0021 第 3 条，UI 规范 §11.14）：插入中、或插入的事暂停时有值。
   * over：被插入的那张——卡（时间盒带今天的量）或自由记录；todayMs / totalMs 是到提交时为止的已计，界面不再按秒补（原来那张在等）。
   * paused：插入的事暂停了；canContinue：〔继续〕能照前一段再开（找不到前一段时灰掉）。
   */
  insert: {
    paused: boolean; canContinue: boolean;
    /** 开着的那一条（插入的事，或插入的事暂停时的待机）：插入结束后看它还开着没有，分「回到任务」和「结束原任务」 */
    entryId: string;
    /** 插入的那件事（暂停时是暂停前那一段） */
    name: string; project: string; startedAt: string | null;
    /** 这件插入的事前面已计完的几段之和（暂停不重置读数，用户 2026-11-06）：读数 = closedMs + (现在 − startedAt) */
    closedMs: number;
    over: { kind: 'card'; cardId: string; title: string; track: '主线' | '支线'; todayMs: number; todayGoal: number | null }
      | { kind: 'free'; title: string; elapsedMs: number };
  } | null;
  dataVersion: number;
}
export const initialHome: HomeSlice = {
  mode: 'blank', entry: null, resumeEntry: null, pending: null, resumeDescription: null, knownTags: [], guideKind: 'firstTask', card: null, closedEffectiveMs: 0, currentSegStartedAt: null,
  closedTodayMs: 0, todayGoal: null, todaySegStartedAt: null,
  awayActivity: null, baseline: { main: null, side: false }, noMainHint: false, rest: null, review: null,
  activity: { kind: 'idle', label: '', startedAt: null }, looseIdle: false, insert: null, dataVersion: 0,
};

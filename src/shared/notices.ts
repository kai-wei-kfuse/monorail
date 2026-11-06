// 提示的种类、内容和回答（架构 §5.6）。noticeSlice 里放 {id, kind, data}；用户回答后 NoticeHost 把 result 交回调用方。
// 所有结果都带 at：用户点下的那一刻（timeboxShort 例外，见下）。
// 结果里的 activity：点选的是快捷活动的 id，手写的是名字；「离线」「睡觉」传名字。timerService 两种都认。

/** project：快捷活动自己的项目，追问对话框选它时自动填进项目选择（用户 2026-11-06：追问的项目应该能选任意项目） */
export interface ActivityOption { id: string; name: string; project?: string }
export interface ProjectChoice { name: string; color: string }
/** 追问对话框的选项：快捷活动（带项目）和全部用户项目（含「未分类」）。离线追问、空闲追问共用。 */
export function askChoices(settings: { lists: { presets: { id: string; name: string; project: string }[]; projects: { name: string; color: string }[] } }) {
  return { activities: settings.lists.presets.map(item => ({ id: item.id, name: item.name, project: item.project })),
    projects: [{ name: '未分类', color: '#888884' }, ...settings.lists.projects.map(p => ({ name: p.name, color: p.color }))] };
}

export interface NoticeData {
  /** 关机、休眠、崩溃后追问「从 X 到 Y 在做什么」。系统已经按「离线」记下，这里只是修改。 */
  offlineAsk: { from: string; to: string; activities: ActivityOption[]; projects?: ProjectChoice[] };
  /** 紧凑模式：待机 / 暂停超过 idleAskMinutes 后开始下一件事，问那一段在做什么（ADR 0021 第 13 条） */
  idleAsk: { entryId: string; from: string; to: string; minutes: number; activities: ActivityOption[]; projects?: ProjectChoice[] };
  /** 补记（用户从状态块主动打开）。now 用来限制补记不能超过现在。 */
  backfill: { activities: ActivityOption[]; now: string };
  /** 同一活动持续太久的轻提醒。 */
  longActivity: { activity: string; startedAt: string; hours: number };
  /** 同一张卡被「再抽一张」跳过多次。 */
  skipSignal: { cardId: string; title: string; count: number };
  /** 同一个休息回答出现多次，建议放进支线格。 */
  subconscious: { answer: string; count: number };
  /** 休息后不久又达到拒绝阈值：提醒换成输入。 */
  inputHint: Record<string, never>;
  /** 时间盒没计满就点了完成。at 是点〔完成〕的那一刻。 */
  timeboxShort: { cardId: string; remainingMinutes: number; at: string };
  /** 休息结束：刚才实际干了什么。 */
  restReturn: { suggestion: string | null };
}

export type BackfillResult =
  | { mode: 'since'; minutesAgo: number; activity: string; at: string }
  | { mode: 'range'; from: string; to: string; activity: string; at: string };

export interface NoticeResult {
  /** project：用户在对话框里选的项目；「离线」「睡觉」不带 */
  offlineAsk: { activity: string; project?: string; at: string };
  idleAsk: { activity: string; project?: string; at: string };
  backfill: BackfillResult;
  longActivity: { still: true; at: string } | { still: false; at: string };
  skipSignal: { choice: 'split' | 'pass' | 'ignore'; at: string };
  subconscious: { accept: boolean; at: string };
  inputHint: { at: string };
  /** 选「就到这」时 at 原样带回点〔完成〕的那一刻（附录 A2），不是选择的那一刻。 */
  timeboxShort: { choice: 'continue' | 'stop'; at: string };
  restReturn: { answer: string; at: string };
}

export type NoticeKind = keyof NoticeData;
export interface Notice<K extends NoticeKind = NoticeKind> { id: string; kind: K; data: NoticeData[K] }

/** 每个提示组件拿到的 props：resolve 给出回答，dismiss 表示不回答直接关掉。 */
export interface NoticeProps<K extends NoticeKind> { data: NoticeData[K]; resolve: (result: NoticeResult[K]) => void; dismiss: () => void }

export const now = () => new Date().toISOString();

// 提示的种类、内容和回答（架构 §5.6）。noticeSlice 里放 {id, kind, data}；用户回答后 NoticeHost 把 result 交回调用方。
// 所有结果都带 at：用户点下的那一刻（timeboxShort 例外，见下）。

export interface NoticeData {
  /** 关机、休眠、崩溃后追问「从 X 到 Y 在做什么」。系统已经按「离线」记下，这里只是修改。 */
  offlineAsk: { from: string; to: string; activities: string[] };
  /** 补记（用户从状态块主动打开）。now 用来限制补记不能超过现在。 */
  backfill: { activities: string[]; now: string };
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
  offlineAsk: { activity: string; at: string };
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

import { emitTo, listen } from '@tauri-apps/api/event';
import { z } from 'zod';
import type { SuggestData } from '../shared/suggest';

const id = z.string().min(1), iso = z.iso.datetime({ offset: true });
const metadata = z.object({ description: z.string().optional(), project: z.string().min(1).optional(), tags: z.array(z.string()).optional() }).strict();
const coverage = z.object({ id, description: z.string(), project: z.string(), tags: z.array(z.string()), card_id: id.nullable(), from: iso, to: iso }).strict();
const plan = z.object({ entryId: id, start: iso, hit: z.array(coverage) }).strict();
// epoch：发起这条命令时（编辑开始时）看到的主窗口会话世代；主窗口只接受和自己相同的（0.3.0-beta.3 D4）
const base = { requestId: id, at: iso, entryId: id.nullable(), cardId: id.nullable(), epoch: z.number().int().nonnegative() };
const edit = { ...base, revision: z.number().int().nonnegative() };
export const miniCommandSchema = z.discriminatedUnion('type', [
  z.object({ ...base, type: z.literal('pause') }).strict(),
  z.object({ ...base, type: z.literal('resume') }).strict(),
  // 0.3.1：resume = 继续（插入的事暂停时继续插入的事）；backToTask = 〔↩ 回到 …〕（ADR 0021 第 3 条）
  z.object({ ...base, type: z.literal('backToTask') }).strict(),
  z.object({ ...base, type: z.literal('complete'), cardId: id }).strict(),
  z.object({ ...base, type: z.literal('openMain') }).strict(),
  z.object({ ...base, type: z.literal('beginPending'), pending_id: z.null() }).strict(),
  z.object({ ...base, type: z.literal('cancelPending'), pending_id: id }).strict(),
  z.object({ ...edit, type: z.literal('editOpen'), pending_id: id.nullable(), patch: metadata }).strict(),
  z.object({ ...edit, type: z.literal('editCard'), cardId: id, content: z.string().min(1), project: z.string().nullable().optional(), tags: z.array(z.string()).optional() }).strict(),
  // 0.3.0-beta.4 D1：写新事件时选中自动完成里的一项，直接开始（同主窗口的收藏 / 开始这张卡 / 继续这一条）
  z.object({ ...edit, type: z.literal('startFavorite'), pending_id: id.nullable(), presetId: id }).strict(),
  z.object({ ...edit, type: z.literal('startCard'), pending_id: id.nullable(), targetCardId: id }).strict(),
  z.object({ ...edit, type: z.literal('continueEntry'), pending_id: id.nullable(), targetEntryId: id }).strict(),
  z.object({ ...edit, type: z.literal('setReadout'), pending_id: id.nullable(),
    target: z.object({ mode: z.enum(['idle', 'pending', 'entry', 'ref', 'refToday', 'insertRun']), id }).strict(), milliseconds: z.number().nonnegative(), seen: plan.nullable() }).strict(),
  // 0.3.2 ADR 0024：小窗显式插入草稿命令（begin/cancel 走 readSerial 零写，commit 走同一提交队列）
  z.object({ ...base, type: z.literal('beginInsertDraft'), ownerSession: id, expectedTimer: id }).strict(),
  z.object({ ...base, type: z.literal('commitInsertDraft'), draftId: id, ownerSession: id, text: z.string().min(1), project: z.string().min(1).optional() }).strict(),
  z.object({ ...base, type: z.literal('cancelInsertDraft'), draftId: id }).strict(),
]);
export type MiniCommand = z.infer<typeof miniCommandSchema>;
export type MiniReadoutPlan = z.infer<typeof plan>;
export interface MiniInsertDraft {
  id: string;
  owner: 'main' | 'mini';
  ownerSession: string;
  at: string;
  phase: 'editing' | 'committing';
  originalTitle: string;
  isCard: boolean;
}
export interface MiniSnapshot {
  accent: string;
  miniMode?: 'mini' | 'tiny';
  /** 主窗口会话世代（Rust begin_main_session 发放，单调递增）；重载后变大，revision 从头计数。 */
  epoch: number;
  /** 主窗每次推送单调递增的视图序号（ADR 0024 第 3 节）：纯内存草稿变化与心跳也推进，同 epoch 严格取更大序号。 */
  viewSeq?: number;
  revision: number; entryId: string | null; cardId: string | null; pending_id: string | null;
  /** 计时状态令牌（与草稿校验及自动化 expected_state 同源） */
  timerStateToken?: string;
  /** 当前状态是否允许点显式〔＋ 插入事件〕（已有草稿时为 false） */
  canInsert?: boolean;
  /** 当前显式插入草稿镜像（无草稿时为 null） */
  insertDraft?: MiniInsertDraft | null;
  entry: { id: string; description: string; project: string; tags: string[]; startedAt: string; cardId: string | null; kind: '普通' | '插入' | '暂停' } | null;
  pending: { id: string; startedAt: string } | null; resumeDescription: string | null;
  card: { id: string; content: string; status: '待做' | '进行中'; project: string | null; tags: string[]; goalMinutes: number | null } | null;
  closedEffectiveMs: number; currentSegStartedAt: string | null; awayActivity: string | null;
  /** 已定 23：卡的读数是今天的（同首页）。旧主窗口不发时按总累计 */
  closedTodayMs?: number; todaySegStartedAt?: string | null; todayGoal?: number | null;
  /** 宽松模式下什么都没在做：写「没在计时」，读数不走（ADR 0021 第 13 条）。旧主窗口不发，按 false */
  looseIdle?: boolean;
  /** 插入状态（ADR 0021 第 3 条）：被插入的那张的名字；paused = 插入的事暂停了；canContinue = 能照前一段再开。旧主窗口不发 */
  inserting?: { originalTitle: string; name: string; paused: boolean; canContinue: boolean; /** 插入的事前面已计完的几段（暂停不归零）；旧主窗口没发按 0 */ closedMs?: number } | null;
  projects: { name: string; color: string }[]; knownTags: string[];
  /** 写新事件时的自动完成（0.3.0-beta.4 D1）：收藏、待做的卡、最近的记录（已去重，最多 100 条） */
  suggest: SuggestData;
}
export type MiniOutcome = { kind: 'done' } | { kind: 'confirm'; plan: MiniReadoutPlan; hit: z.infer<typeof coverage>[] }
  | { kind: 'complete'; cardId: string; at: string } | { kind: 'openMain' } | { kind: 'error'; message: string };
export interface MiniReply { requestId: string; outcome: MiniOutcome }
export interface MainWindowBus {
  onCommand(handler: (message: MiniMessage) => void): Promise<() => void>;
  onReady(handler: (session?: string) => void): Promise<() => void>;
  push(snapshot: MiniSnapshot): Promise<void>;
  reply(value: MiniReply): Promise<void>;
}
export type MiniMessage = { command: MiniCommand } | { requestId: string | null; error: string };
export function decodeMiniCommand(payload: unknown): MiniMessage {
  const parsed = miniCommandSchema.safeParse(payload);
  if (parsed.success) return { command: parsed.data };
  const requestId = typeof payload === 'object' && payload !== null && 'requestId' in payload && typeof payload.requestId === 'string' ? payload.requestId : null;
  return { requestId, error: `小窗命令无效：${parsed.error.message}` };
}
export interface MiniWindowBus {
  onSnapshot(handler: (snapshot: MiniSnapshot) => void): Promise<() => void>;
  onReply(handler: (reply: MiniReply) => void): Promise<() => void>;
  ready(session?: string): Promise<void>; send(command: MiniCommand): Promise<void>;
}
export const mainWindowBus: MainWindowBus = {
  onCommand: handler => listen<unknown>('mini-command', event => handler(decodeMiniCommand(event.payload))),
  onReady: handler => listen<unknown>('mini-ready', event => {
    const payload = event.payload;
    const session = typeof payload === 'object' && payload !== null && 'session' in payload && typeof (payload as { session?: unknown }).session === 'string'
      ? (payload as { session: string }).session : undefined;
    handler(session);
  }),
  push: snapshot => emitTo('mini', 'mini-snapshot', snapshot),
  reply: value => emitTo('mini', 'mini-reply', value),
};
/**
 * 小窗收到的快照要不要接（审核 G3 + ADR 0024 第 3 节）：
 * - 更大的 epoch 是主窗口重载后的新会话，接受并以它为新基准；更小的 epoch 是旧会话迟到的，丢弃；
 * - 同一 epoch 内若双方都带 viewSeq，严格只接受 next.viewSeq > seen.viewSeq（每次 push/心跳均分配递增 viewSeq，防止纯内存草稿乱序复活）；
 * - 未带 viewSeq 的旧测试/快照按 next.revision >= seen.revision 兼容。
 */
export function acceptMiniSnapshot(
  seen: { epoch: number; revision: number; viewSeq?: number } | null,
  next: { epoch: number; revision: number; viewSeq?: number },
): boolean {
  if (!seen) return true;
  if (next.epoch !== seen.epoch) return next.epoch > seen.epoch;
  if (next.viewSeq !== undefined && seen.viewSeq !== undefined) return next.viewSeq > seen.viewSeq;
  return next.revision >= seen.revision;
}
export const miniWindowBus: MiniWindowBus = {
  onSnapshot: handler => {
    let seen: { epoch: number; revision: number; viewSeq?: number } | null = null;
    return listen<MiniSnapshot>('mini-snapshot', event => {
      // Replies and publish/heartbeat events can cross; an older commit or an older session must never replace a newer view.
      if (!acceptMiniSnapshot(seen, event.payload)) return;
      seen = { epoch: event.payload.epoch, revision: event.payload.revision, viewSeq: event.payload.viewSeq }; handler(event.payload);
    });
  },
  onReply: handler => listen<MiniReply>('mini-reply', event => handler(event.payload)),
  ready: (session?: string) => emitTo('main', 'mini-ready', session ? { session } : undefined),
  send: command => emitTo('main', 'mini-command', miniCommandSchema.parse(command)),
};
// The design requires a warning after three seconds without a snapshot. Heartbeats do not advance revision.
export const MINI_HEARTBEAT_MS = 1000;
export const MINI_STALE_MS = 3000;
export const miniUnresponsive = (lastReceivedAt: number | null, mountedAt: number, now: number) => now - (lastReceivedAt ?? mountedAt) > MINI_STALE_MS;

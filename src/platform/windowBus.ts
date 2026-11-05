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
    target: z.object({ mode: z.enum(['idle', 'pending', 'entry', 'ref']), id }).strict(), milliseconds: z.number().nonnegative(), seen: plan.nullable() }).strict(),
]);
export type MiniCommand = z.infer<typeof miniCommandSchema>;
export type MiniReadoutPlan = z.infer<typeof plan>;
export interface MiniSnapshot {
  accent: string;
  miniMode?: 'mini' | 'tiny';
  /** 主窗口会话世代（Rust begin_main_session 发放，单调递增）；重载后变大，revision 从头计数。 */
  epoch: number;
  revision: number; entryId: string | null; cardId: string | null; pending_id: string | null;
  entry: { id: string; description: string; project: string; tags: string[]; startedAt: string; cardId: string | null; kind: '普通' | '插入' | '暂停' } | null;
  pending: { id: string; startedAt: string } | null; resumeDescription: string | null;
  card: { id: string; content: string; status: '待做' | '进行中'; project: string | null; tags: string[]; goalMinutes: number | null } | null;
  closedEffectiveMs: number; currentSegStartedAt: string | null; awayActivity: string | null;
  projects: { name: string; color: string }[]; knownTags: string[];
  /** 写新事件时的自动完成（0.3.0-beta.4 D1）：收藏、待做的卡、最近的记录（已去重，最多 100 条） */
  suggest: SuggestData;
}
export type MiniOutcome = { kind: 'done' } | { kind: 'confirm'; plan: MiniReadoutPlan; hit: z.infer<typeof coverage>[] }
  | { kind: 'complete'; cardId: string; at: string } | { kind: 'openMain' } | { kind: 'error'; message: string };
export interface MiniReply { requestId: string; outcome: MiniOutcome }
export interface MainWindowBus {
  onCommand(handler: (message: MiniMessage) => void): Promise<() => void>;
  onReady(handler: () => void): Promise<() => void>;
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
  ready(): Promise<void>; send(command: MiniCommand): Promise<void>;
}
export const mainWindowBus: MainWindowBus = {
  onCommand: handler => listen<unknown>('mini-command', event => handler(decodeMiniCommand(event.payload))),
  onReady: handler => listen('mini-ready', () => handler()),
  push: snapshot => emitTo('mini', 'mini-snapshot', snapshot),
  reply: value => emitTo('mini', 'mini-reply', value),
};
/**
 * 小窗收到的快照要不要接（审核 G3）：按 (epoch, revision) 字典序比较。更大的 epoch 是主窗口重载后的新会话，
 * 接受并以它为新基准（它的 revision 从头计数）；更小的 epoch 是旧会话迟到的，丢弃；同一会话里丢弃更小的 revision，
 * 心跳带着相同的 revision 照常接受。还没接过任何快照时什么都接。不需要「已退役会话」集合：
 * 连续重载 A → B → C 时，C 先到、B 迟到，B 的 epoch 比 C 小，会被丢弃。
 */
export function acceptMiniSnapshot(seen: { epoch: number; revision: number } | null, next: { epoch: number; revision: number }): boolean {
  if (!seen) return true;
  if (next.epoch !== seen.epoch) return next.epoch > seen.epoch;
  return next.revision >= seen.revision;
}
export const miniWindowBus: MiniWindowBus = {
  onSnapshot: handler => {
    let seen: { epoch: number; revision: number } | null = null;
    return listen<MiniSnapshot>('mini-snapshot', event => {
      // Replies and publish/heartbeat events can cross; an older commit or an older session must never replace a newer view.
      if (!acceptMiniSnapshot(seen, event.payload)) return;
      seen = { epoch: event.payload.epoch, revision: event.payload.revision }; handler(event.payload);
    });
  },
  onReply: handler => listen<MiniReply>('mini-reply', event => handler(event.payload)),
  ready: () => emitTo('main', 'mini-ready'),
  send: command => emitTo('main', 'mini-command', miniCommandSchema.parse(command)),
};
// The design requires a warning after three seconds without a snapshot. Heartbeats do not advance revision.
export const MINI_HEARTBEAT_MS = 1000;
export const MINI_STALE_MS = 3000;
export const miniUnresponsive = (lastReceivedAt: number | null, mountedAt: number, now: number) => now - (lastReceivedAt ?? mountedAt) > MINI_STALE_MS;

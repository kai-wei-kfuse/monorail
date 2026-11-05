import { parseEntryText } from '../../shared/tags';

export interface IdeaCompletedBy { kind: 'manual' | 'mcp' | 'cli' | 'automation'; agent: string | null }

export interface RecordEntry {
  id: string; text: string; kind: '待办' | '想法'; created_at: string;
  due_at: string | null; blocking: boolean; task_id: string | null;
  card_id: string | null; tags: string[]; attachments: string[];
  needs: string | null; pool: '活跃池' | '冷库' | '已转任务' | null;
  last_touched_at: string; cold_since: string | null;
  /**
   * 想法已完成的时刻（ADR 0020）。只在 pool 为「冷库」时有意义：冷库 + completed_at = 已完成；
   * 旧版本（v0.2.5、0.3.0-beta.1–3）把它当冷库想法，原样保留这两个字段。
   */
  completed_at?: string | null;
  /** 谁标的完成，只用于显示（取自那次操作的历史来源，自报、未验证）。 */
  completed_by?: IdeaCompletedBy | null;
  /** 快速记录条存的记录（ADR 0019 第 5 条「先补记、再消费」）；主窗口、MCP、CLI 新建的没有这一项 */
  created_via?: 'quickbar';
  /** 已为这条快速记录写过操作历史（或已过保留期、只做了标记）的时刻；簿记字段，不算实质改动 */
  history_logged_at?: string;
}

/** M0/M1 callers supplied no idea lifecycle fields; storage migrates that known format. */
export type RecordInput = Omit<RecordEntry, 'needs' | 'pool' | 'last_touched_at' | 'cold_since'> &
  Partial<Pick<RecordEntry, 'needs' | 'pool' | 'last_touched_at' | 'cold_since'>>;

export function extractTags(text: string): string[] {
  return parseEntryText(text, []).tags;
}

export function createRecord(input: RecordInput): RecordEntry {
  if (!input.text.trim() && input.attachments.length === 0) throw new Error('记录内容或附件不能为空');
  return { ...input, tags: extractTags(input.text), needs: input.needs?.trim() || null,
    pool: input.kind === '想法' ? '活跃池' : null, last_touched_at: input.created_at, cold_since: null };
}

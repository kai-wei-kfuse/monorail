import { canonicalJson } from '../../shared/operation';
import { sha256Hex } from '../../shared/sha256';
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

/** ADR 0026：统一 CRLF / CR 为 LF，不做 trim 或截断。 */
export function normalizeBody(text: string): string {
  return text.replace(/\r\n|\r/g, '\n');
}

/**
 * ADR 0026 兼容全文拼接 C(title, details)：
 * D 为空返回 A；A 为空返回 D；D 以 LF 开头返回 A + D；否则返回 A + LF + D。
 */
export function compatibleRecordText(title: string, details: string): string {
  const A = title;
  const D = normalizeBody(details);
  if (D === '') return A;
  if (A === '') return D;
  if (D.startsWith('\n')) return A + D;
  return `${A}\n${D}`;
}

export function extractTags(text: string): string[] {
  return parseEntryText(text, []).tags;
}

export function extractRecordTags(title: string, details = ''): string[] {
  return extractTags(compatibleRecordText(title, details));
}

export function bodyDigest(details: string): string {
  const normalized = normalizeBody(details);
  return normalized === '' ? '' : sha256Hex(normalized);
}

export function computeRecordRevision(input: {
  id: string;
  text: string;
  details_markdown: string;
  needs: string | null;
  tags: readonly string[];
  attachments: readonly string[];
}): string {
  return `ir3:${sha256Hex(canonicalJson({
    id: input.id,
    text: input.text,
    details_markdown: normalizeBody(input.details_markdown),
    needs: input.needs,
    tags: [...input.tags],
    attachments: [...input.attachments],
  }))}`;
}

/**
 * ADR 0026 旧数据/旧 save_idea 机械映射（A/R/B 固定算法）：
 * N(s) 归一 CRLF/CR -> LF；R 保留首个 LF。
 */
export function mapLegacyIdeaContent(
  oldText: string,
  oldBody: string,
  attachments: readonly string[] = [],
  path = 'records',
): { title: string; details: string } {
  const T = normalizeBody(oldText);
  const B = normalizeBody(oldBody);
  if (!T.trim() && !B.trim() && attachments.length === 0) {
    throw new Error(`${path}: 记录内容或附件不能为空`);
  }
  const i = T.indexOf('\n');
  const A = i < 0 ? T : T.slice(0, i);
  const R = i < 0 ? '' : T.slice(i);
  if (T === '') return { title: '', details: B };
  if (B === T) return { title: A, details: R };
  if (B === '') return { title: A, details: R };
  if (B.startsWith(T) && (T.endsWith('\n') || B.slice(T.length).startsWith('\n'))) {
    return { title: A, details: R + B.slice(T.length) };
  }
  return { title: A, details: R === '' ? B : `${R}\n\n${B}` };
}

export function splitLegacyIdeaText(rawText: string): { title: string; details: string } {
  const T = normalizeBody(rawText);
  const i = T.indexOf('\n');
  if (i < 0) return { title: T, details: '' };
  return { title: T.slice(0, i), details: T.slice(i) };
}

export function createRecordWithDetails(input: RecordInput & { details?: string }): { record: RecordEntry; details: string } {
  const { details: explicitDetails, ...rest } = input;
  if (rest.kind === '想法') {
    let title: string;
    let details: string;
    if (explicitDetails !== undefined) {
      if (rest.text.includes('\n') || rest.text.includes('\r')) {
        throw new Error('INVALID_ARGUMENTS：想法标题不能包含换行');
      }
      title = rest.text;
      details = normalizeBody(explicitDetails);
    } else {
      const split = splitLegacyIdeaText(rest.text);
      title = split.title;
      details = split.details;
    }
    if (!title.trim() && !details.trim() && rest.attachments.length === 0) {
      throw new Error('记录内容或附件不能为空');
    }
    const record: RecordEntry = {
      ...rest,
      text: title,
      tags: extractRecordTags(title, details),
      needs: rest.needs?.trim() || null,
      pool: '活跃池',
      last_touched_at: rest.created_at,
      cold_since: null,
    };
    return { record, details };
  }
  if (!rest.text.trim() && rest.attachments.length === 0) throw new Error('记录内容或附件不能为空');
  const record: RecordEntry = {
    ...rest,
    tags: extractTags(rest.text),
    needs: rest.needs?.trim() || null,
    pool: null,
    last_touched_at: rest.created_at,
    cold_since: null,
  };
  return { record, details: rest.text };
}

export function createRecord(input: RecordInput & { details?: string }): RecordEntry {
  return createRecordWithDetails(input).record;
}

export interface RecordEntry {
  id: string; text: string; kind: '待办' | '想法'; created_at: string;
  due_at: string | null; blocking: boolean; project_id: string | null;
  card_id: string | null; tags: string[]; attachments: string[];
  needs: string | null; pool: '活跃池' | '冷库' | '已转待办' | null;
  last_touched_at: string; cold_since: string | null;
}

/** M0/M1 callers supplied no idea lifecycle fields; storage migrates that known format. */
export type RecordInput = Omit<RecordEntry, 'needs' | 'pool' | 'last_touched_at' | 'cold_since'> &
  Partial<Pick<RecordEntry, 'needs' | 'pool' | 'last_touched_at' | 'cold_since'>>;

export function extractTags(text: string): string[] {
  return [...new Set([...text.matchAll(/(?:^|\s)#([\p{L}\p{N}_-]+)/gu)].map(match => match[1]))];
}

export function createRecord(input: RecordInput): RecordEntry {
  if (!input.text.trim() && input.attachments.length === 0) throw new Error('记录内容或附件不能为空');
  return { ...input, tags: extractTags(input.text), needs: input.needs?.trim() || null,
    pool: input.kind === '想法' ? '活跃池' : null, last_touched_at: input.created_at, cold_since: null };
}

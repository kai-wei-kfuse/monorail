export interface Segment {
  id: string; seq: number; started_at: string; ended_at: string | null;
  activity: string; project: string; card_id: string | null;
  kind: '普通' | '插入'; source: '手动' | '补记' | '自动' | '离线追问';
  resume_card_id: string | null;
}

export function closeSegment(segment: Segment, at: string): Segment {
  if (segment.ended_at !== null) throw new Error('计时段已经关闭');
  if (Date.parse(at) < Date.parse(segment.started_at)) throw new Error('命令时间早于当前计时段');
  return { ...segment, ended_at: at };
}

export function elapsedMs(segment: Segment, now: string): number {
  return Date.parse(segment.ended_at ?? now) - Date.parse(segment.started_at);
}

export interface Card {
  id: string; source_record_id: string | null; content: string; created_at: string;
  due_at: string | null; blocking: boolean; project_id: string | null;
  status: '待做' | '进行中' | '已完成' | '已缩小' | '已放弃'; type: '结果卡' | '时间盒卡'; order: number;
  timebox_minutes: number | null; no_shrink: boolean;
  shrunk_from: string | null; shrink_level: number; continued_from: string | null; skip_count: number;
  completed_at: string | null; completed_day: string | null;
  completed_track: '主线' | '支线' | null; progress_note: string;
}

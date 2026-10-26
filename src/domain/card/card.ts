export interface Card {
  id: string; source_record_id: string; content: string; created_at: string;
  due_at: string | null; blocking: boolean; project_id: string | null;
  status: '待做' | '进行中' | '已完成'; type: '结果卡'; order: number;
  completed_at: string | null; completed_day: string | null;
  completed_track: '主线' | '支线' | null; progress_note: string;
}

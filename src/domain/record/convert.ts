import type { RecordEntry } from './record';
import type { Card } from '../card/card';

export function convert(record: RecordEntry, order: number): Card {
  if (record.kind !== '待办') throw new Error('只有待办可以自动转换');
  return {
    id: `card-${record.id}`, source_record_id: record.id, content: record.text,
    created_at: record.created_at, due_at: record.due_at, blocking: record.blocking,
    project_id: record.project_id, status: '待做', type: '结果卡', order,
    completed_at: null, completed_day: null, completed_track: null, progress_note: '',
  };
}

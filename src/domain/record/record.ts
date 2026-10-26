export interface RecordEntry {
  id: string; text: string; kind: '待办' | '想法'; created_at: string;
  due_at: string | null; blocking: boolean; project_id: string | null;
  card_id: string | null; tags: string[]; attachments: string[];
}

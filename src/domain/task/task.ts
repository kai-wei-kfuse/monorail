export interface Task {
  id: string; name: string; slot: '主线' | '支线'; slot_index: number | null;
  status: '进行中' | '冷藏' | '已放弃' | '已完成'; created_at: string; bet_ends_at: string | null; default_project: string | null;
}
export const inBackpack = (task: Task) => task.status === '进行中';

/** A card counts as 主线 only while its task sits in the backpack's main slot; loose cards are 支线. */
export const trackOf = (taskId: string | null, tasks: Task[]): '主线' | '支线' =>
  tasks.some(p => p.id === taskId && inBackpack(p) && p.slot === '主线') ? '主线' : '支线';

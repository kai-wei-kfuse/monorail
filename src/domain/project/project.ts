export interface Project {
  id: string; name: string; slot: '主线' | '支线' | '不在背包'; slot_index: number | null;
  status: '进行中' | '冷藏' | '已放弃'; created_at: string; bet_ends_at: string | null;
}
export const inBackpack = (project: Project) => project.status === '进行中' && project.slot !== '不在背包';

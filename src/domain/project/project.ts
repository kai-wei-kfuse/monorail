export interface Project {
  id: string; name: string; slot: '主线' | '支线' | '不在背包'; slot_index: number | null;
  status: '进行中' | '冷藏' | '已放弃'; created_at: string; bet_ends_at: string | null;
}
export const inBackpack = (project: Project) => project.status === '进行中' && project.slot !== '不在背包';

/** A card counts as 主线 only while its project sits in the backpack's main slot; loose cards are 支线. */
export const trackOf = (projectId: string | null, projects: Project[]): '主线' | '支线' =>
  projects.some(p => p.id === projectId && inBackpack(p) && p.slot === '主线') ? '主线' : '支线';

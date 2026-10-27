export interface CardFields {
  content: string; type: '结果卡' | '时间盒卡'; timeboxMinutes: number | null;
  blocking: boolean; dueAt: string | null; noShrink: boolean; projectId: string | null;
}
export type BackpackSlot = '主线' | '支线';
export interface MakeRoom { id: string; action: '冷藏' | '放弃' }
export interface ProjectDraft { name: string; slot: BackpackSlot | '不在背包'; makeRoom: MakeRoom | null }

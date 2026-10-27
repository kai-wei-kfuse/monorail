import type { CardFields } from '../shared/backpack';

export interface ProjectView {
  id: string; name: string; slot: '主线' | '支线' | '不在背包'; slotIndex: number | null;
  status: '进行中' | '冷藏' | '已放弃'; betEndsAt: string | null; openCards: number;
}
export interface QueueCard {
  id: string; fields: CardFields; status: '待做' | '进行中';
  shrinkLevel: number; skipCount: number; progressNote: string | null; passBlocked?: string;
}
export interface QueueGroup { projectId: string | null; name: string; slotLabel: string; cards: QueueCard[] }
export interface IdeaView {
  id: string; text: string; tags: string[]; needs: string | null; pool: '活跃池' | '已转待办'; createdAt: string; lastTouchedAt: string;
}
export interface ColdIdea { id: string; text: string; needs: string | null; coldSince: string }
export interface BackpackSlice { projects: ProjectView[]; queue: QueueGroup[]; ideas: IdeaView[]; coldIdeas: ColdIdea[] }
export const initialBackpack: BackpackSlice = { projects: [], queue: [], ideas: [], coldIdeas: [] };

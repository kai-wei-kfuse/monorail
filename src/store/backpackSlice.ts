import type { CardFields } from '../shared/backpack';
import { defaults } from '../shared/settings';

export interface PoolItem {
  id: string; content: string; type: '结果卡' | '时间盒卡'; timeboxMinutes: number | null; elapsedMs: number; running: boolean;
  blocking: boolean; dueAt: string | null; shrinkLevel: number; project: string | null; tags: string[];
}
export interface PoolTask { id: string; name: string; track: '主线' | '支线'; items: PoolItem[]; defaultProject: string; overLimit: boolean }
export interface PoolView {
  mains: PoolTask[]; sides: PoolTask[]; parked: { id: string; name: string; track: '主线' | '支线'; itemCount: number }[];
  doneSides: string[]; mainMax: number; sideMax: number; mainItems: number;
  projects: { name: string; color: string }[]; knownTags: string[]; excessSideIds: string[];
}

export interface TaskView {
  id: string; name: string; slot: '主线' | '支线' | '不在背包'; slotIndex: number | null;
  status: '进行中' | '冷藏' | '已放弃' | '已完成'; betEndsAt: string | null; openCards: number;
}
export interface QueueCard {
  id: string; fields: CardFields; status: '待做' | '进行中';
  shrinkLevel: number; skipCount: number; progressNote: string | null; passBlocked?: string;
}
export interface QueueGroup { taskId: string | null; name: string; slotLabel: string; cards: QueueCard[] }
export interface IdeaView {
  id: string; text: string; tags: string[]; needs: string | null; pool: '活跃池' | '已转任务'; createdAt: string; lastTouchedAt: string;
}
export interface ColdIdea { id: string; text: string; needs: string | null; coldSince: string }
export interface BackpackSlice { tasks: TaskView[]; queue: QueueGroup[]; ideas: IdeaView[]; coldIdeas: ColdIdea[]; pool: PoolView }
export const initialBackpack: BackpackSlice = { tasks: [], queue: [], ideas: [], coldIdeas: [], pool: {
  mains: [], sides: [], parked: [], doneSides: [], mainMax: defaults.mainTasks, sideMax: defaults.sideTasks,
  mainItems: defaults.mainItems, projects: [], knownTags: [], excessSideIds: [],
} };

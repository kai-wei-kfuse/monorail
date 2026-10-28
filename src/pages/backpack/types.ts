import type { CardFields } from '../../widgets/CardEditor';

/** 背包页要显示的数据。由调用方从 store / service 查询结果组装，页面只读。 */
export interface ProjectView {
  id: string; name: string;
  slot: '主线' | '支线' | '不在背包'; slotIndex: number | null;
  status: '进行中' | '冷藏' | '已放弃';
  betEndsAt: string | null;   // 只有主线有
  openCards: number;          // 待做 + 进行中的卡数
}

export interface QueueCard {
  id: string; fields: CardFields;
  status: '待做' | '进行中';
  shrinkLevel: number; skipCount: number; progressNote: string | null;
  passBlocked?: string;       // 不能 PASS 时的原因（已缩小的卡，附录 A6）
}

/** 一个项目（或不属于项目的那组卡）的队列。缩小链只放最末端那张卡，由调用方过滤好。 */
export interface QueueGroup { projectId: string | null; name: string; slotLabel: string; cards: QueueCard[] }

export interface IdeaView {
  id: string; text: string; tags: string[]; needs: string | null;
  pool: '活跃池' | '已转待办';
  createdAt: string; lastTouchedAt: string;
}

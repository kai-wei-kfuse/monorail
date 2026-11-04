import type { ReviewStep } from '../domain/review/flow';
export type { ReviewStep };
interface DuelIdea { id: string; text: string; needs: string | null; lastTouchedAt: string; isNew: boolean }
/** 回看不在这里：0.3.0-beta.3 起随时可看，由 recapService 按需查询，不随每次提交重算。 */
export interface ReviewData {
  period: string; step: ReviewStep; done: ReviewStep[]; betDue: boolean;
  addedIdeas: string[]; duel: { left: DuelIdea; right: DuelIdea; over: number } | null;
  cold: { offered: { id: string; text: string; needs: string | null; coldSince: string }[]; poolFree: number };
  bet: { taskId: string; task: string; betEndsAt: string; betWeeks: number } | null;
  backpack: { inBackpack: { id: string; name: string; slot: '主线' | '支线' }[]; sideFree: boolean };
}
export type ReviewSlice = ReviewData | null;

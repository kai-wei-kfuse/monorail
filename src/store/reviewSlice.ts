import type { ReviewStep } from '../domain/review/flow';
export type { ReviewStep };
export interface RecapData {
  completed: { id: string; content: string; task: string; day: string; minutes: number }[];
  totals: { project: string; minutes: number }[];
  notes: { id: string; content: string; note: string }[];
}
interface DuelIdea { id: string; text: string; needs: string | null; lastTouchedAt: string; isNew: boolean }
export interface ReviewData {
  period: string; step: ReviewStep; done: ReviewStep[]; betDue: boolean; recap: RecapData;
  addedIdeas: string[]; duel: { left: DuelIdea; right: DuelIdea; over: number } | null;
  cold: { offered: { id: string; text: string; needs: string | null; coldSince: string }[]; poolFree: number };
  bet: { taskId: string; task: string; betEndsAt: string; betWeeks: number } | null;
  backpack: { inBackpack: { id: string; name: string; slot: '主线' | '支线' }[]; sideFree: boolean };
}
export type ReviewSlice = ReviewData | null;

import type { Card } from '../card/card';
import type { Task } from '../task/task';
import { inBackpack } from '../task/task';
import type { TimeEntry } from '../timeline/entry';
import { achieved, minutesOnDay, workable } from '../plan/plan';
import type { DayPlan, PlanPriority } from '../plan/plan';
import { guide } from './guide';
import type { GuideKind } from './guide';

/**
 * 抽卡（ADR 0021 第 2 条）：候选只来自今天的板子，按权重抽一张。去掉了阻塞、回顾卡、快到期、每日底线。
 * 结果只给界面（翻卡），不写首页状态；〔开始〕〔换一张〕是另外的写事务。
 */
export const MAIN_CARD_WEIGHT = 1.5;
export const PRIORITY_WEIGHT: Record<PlanPriority, number> = { 普通: 1, 高: 3 };

export interface PickInput {
  plan: DayPlan; cards: readonly Card[]; tasks: readonly Task[]; entries: readonly TimeEntry[];
  boundaryHour: number; at: string;
  /** 正在做的卡（含插入中、暂停中原来那张），不进候选 */
  activeCard: string | null;
  /** 插入状态下不能抽（已定 20） */
  inserting: boolean;
  /** 0.3.0 遗留的降级休息还没处理 */
  legacyRest: boolean;
  random: number;
}
export interface Candidate { card: Card; priority: PlanPriority; weight: number }
export type PickResult =
  | { kind: 'task'; card: Card; candidates: Candidate[]; resetRound: boolean }
  | { kind: 'plan' } | { kind: 'confirmCarry' }
  | { kind: 'blocked'; reason: 'inserting' | 'rest' }
  | { kind: 'done' }
  | { kind: 'guide'; guide: GuideKind };

export function isCandidate(card: Card, tasks: readonly Task[]): boolean {
  return (card.status === '待做' || card.status === '进行中') && (card.task_id === null || tasks.some(p => p.id === card.task_id && inBackpack(p)));
}
const weightOf = (card: Card, priority: PlanPriority, tasks: readonly Task[]) =>
  PRIORITY_WEIGHT[priority] * (card.task_id !== null && tasks.some(t => t.id === card.task_id && inBackpack(t) && t.slot === '主线') ? MAIN_CARD_WEIGHT : 1);

/** 板子上现在能抽的卡（不排除 seen）：卡在背包、今天没达成、不是正在做的那张、不是待确认的带过来项。 */
export function drawableOnPlan(input: Omit<PickInput, 'random' | 'inserting' | 'legacyRest'>): Candidate[] {
  const byId = new Map(input.cards.map(card => [card.id, card]));
  const out: Candidate[] = [];
  for (const item of input.plan.items) {
    const card = byId.get(item.card_id);
    if (!workable(card, input.tasks) || card.id === input.activeCard || item.carried) continue;
    if (achieved(item, card, minutesOnDay(input.entries, card.id, input.plan.day, input.boundaryHour, input.at))) continue;
    out.push({ card, priority: item.priority, weight: weightOf(card, item.priority, input.tasks) });
  }
  return out;
}

function weighted(list: Candidate[], random: number): Candidate {
  if (!(random >= 0 && random < 1)) throw new Error('Invalid selection random value');
  const sorted = [...list].sort((a, b) => a.card.order - b.card.order || a.card.id.localeCompare(b.card.id));
  let remaining = random * sorted.reduce((sum, c) => sum + c.weight, 0);
  for (const c of sorted) { remaining -= c.weight; if (remaining < 0) return c; }
  return sorted.at(-1)!;
}

export function pickFromPlan(input: PickInput): PickResult {
  if (input.inserting) return { kind: 'blocked', reason: 'inserting' };
  if (input.legacyRest) return { kind: 'blocked', reason: 'rest' };
  const { plan } = input;
  let all: Candidate[];
  if (!plan.items.length) {
    if (!plan.skip_until_planned) return { kind: 'plan' };
    // 「这次先不排」：从整个背包抽，只做加权随机（优先级都按普通）
    all = input.cards.filter(card => isCandidate(card, input.tasks) && card.id !== input.activeCard)
      .map(card => ({ card, priority: '普通' as const, weight: weightOf(card, '普通', input.tasks) }));
    if (!all.length) return { kind: 'guide', guide: guide([...input.cards], [...input.tasks]) };
  } else {
    if (!plan.carried_confirmed && plan.items.some(item => item.carried)) return { kind: 'confirmCarry' };
    all = drawableOnPlan(input);
    if (!all.length) return { kind: 'done' };
  }
  const left = all.filter(c => !plan.seen.includes(c.card.id));
  const resetRound = left.length === 0;
  const pool = resetRound ? all : left;
  return { kind: 'task', card: weighted(pool, input.random).card, candidates: pool, resetRound };
}

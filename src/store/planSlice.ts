import type { PlanPriority } from '../domain/plan/plan';

/** 今日任务板的一行（ADR 0021 第 1 条；界面 UI 风格规范 §11.15）。 */
export interface PlanRow {
  cardId: string; title: string; taskName: string | null; track: '主线' | '支线';
  priority: PlanPriority; type: '结果卡' | '时间盒卡';
  /** 时间盒：今天的量（分钟）；结果卡为 null */
  todayMinutes: number | null;
  /** 今天已计（分钟，提交时算；正在计那一行由界面按秒补） */
  minutesToday: number;
  achieved: boolean; running: boolean; carried: boolean;
  /** 那天到期（标红） */
  dueThatDay: boolean;
}
export interface PlanBoard {
  day: string; rows: PlanRow[];
  /** 板子上达成的 / 显示的 */
  achieved: number; total: number;
  skipUntilPlanned: boolean;
  /** 有带过来、还没确认的 */
  carryPending: boolean; carriedFrom: string | null;
  /** 现在能抽的项（翻卡的背面就是这几张，最多 6 张由界面截）：不含正在做的、已达成的、待确认的带过来项（同 drawableOnPlan） */
  drawable: string[];
}
export interface PlanSlice { today: PlanBoard; tomorrow: PlanBoard }
const empty = (day: string): PlanBoard => ({ day, rows: [], achieved: 0, total: 0, skipUntilPlanned: false, carryPending: false, carriedFrom: null, drawable: [] });
export const initialPlan: PlanSlice = { today: empty(''), tomorrow: empty('') };

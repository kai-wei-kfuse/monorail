/*
 * 回看（0.3.0-beta.3 D7，执行方案 E6）的查询参数与结果类型。domain 计算、services 查询、pages 显示共用这一份。
 * 时长一律是整数毫秒；占比是千分数（整数，合计 1000，显示时除以 10 得到一位小数的百分比）。
 */

export type RecapPeriod = 'week' | 'lastWeek' | 'cycle' | 'month' | 'quarter' | 'year' | 'custom';
export type RecapDimension = 'project' | 'tag' | 'source' | 'activity';
export type RecapUnit = 'day' | 'week' | 'month';
export type RecapView = 'card' | 'list';

export const RECAP_PERIODS: { id: RecapPeriod; cn: string; en: string }[] = [
  { id: 'week', cn: '本周', en: 'THIS WEEK' },
  { id: 'lastWeek', cn: '上周', en: 'LAST WEEK' },
  { id: 'cycle', cn: '本次回顾周期', en: 'SINCE LAST REVIEW' },
  { id: 'month', cn: '本月', en: 'THIS MONTH' },
  { id: 'quarter', cn: '近 3 个月', en: 'LAST 3 MONTHS' },
  { id: 'year', cn: '最近一年', en: 'LAST 1 YEAR' },
  { id: 'custom', cn: '自定义时间', en: 'CUSTOM RANGE' },
];
export const RECAP_DIMENSIONS: { id: RecapDimension; cn: string; en: string }[] = [
  { id: 'project', cn: '项目分类', en: 'PROJECT' },
  { id: 'tag', cn: '标签', en: '#TAG' },
  { id: 'source', cn: '任务与来源', en: 'TASK & SOURCE' },
  { id: 'activity', cn: '具体活动', en: 'ACTIVITY' },
];
/** 「任务与来源」四类，顺序固定（主线投入卡的分段条也按这个顺序）。 */
export const RECAP_SOURCES = ['主线任务', '支线任务', '自由活动', '临时离开'] as const;
export type RecapSource = (typeof RECAP_SOURCES)[number];
/** 「含待机/睡眠」开关控制的系统项。 */
export const RECAP_IDLE_PROJECTS = ['待机', '睡眠'] as const;
export const NO_TAG = '无标签';
export const OTHER = '其他';
/** 图表单独配色的最多项数，其余合并成灰色「其他」（计划 v1.10 定稿）。 */
export const CHART_TOP = 8;

export interface RecapQuery {
  period: RecapPeriod;
  /** 只有 custom 用：活动日 YYYY-MM-DD，起止都含；先后顺序不限。 */
  from?: string; to?: string;
  dim: RecapDimension;
  includeIdle: boolean;
  /** 只看某一根柱子（桶 id）：分组和明细只算这一桶的天，图表、概览照旧是整个周期。 */
  bucket?: string | null;
}

/** 解析出来的周期：活动日起止（含）与时刻范围 [from, to)。cycle 的 from 是上次完成回顾的时刻。 */
export interface RecapRange {
  period: RecapPeriod;
  fromDay: string; toDay: string; days: number;
  from: string; to: string;
  /** 到现在为止：min(to, max(from, asOf)) */
  effectiveTo: string;
  /** cycle：从这一刻起算（同一天更早的部分不算） */
  after: string | null;
}

export interface RecapBucket {
  id: string; label: string; sub: string; title: string; weekend: boolean;
  days: string[]; totalMs: number;
  /** 按图表系列（前 8 名 + 其他）分的时长 */
  byKey: Record<string, number>;
}

/** 明细的二级行：具体活动维度是一条一条的条目，其他维度按描述合并。 */
export interface RecapRow {
  key: string; description: string; ms: number; count: number;
  firstDay: string; lastDay: string;
  /** 只有单条（具体活动维度）才有起止 */
  start: string | null; end: string | null;
  project: string; tags: string[];
  card: { id: string; content: string; track: '主线' | '支线' } | null;
  source: RecapSource | null;
}
export interface RecapGroup {
  key: string; ms: number; permille: number; count: number; color: string;
  /** 上一期这一组的时长；上一期没有这一组时为 null（「新出现」）；上一期不可比时为 undefined */
  previousMs?: number | null;
  rows: RecapRow[];
}
export interface RecapSeries { key: string; ms: number; permille: number; color: string; merged: number }

export interface RecapDoneCard {
  id: string; content: string; task: string; track: '主线' | '支线'; day: string; at: string;
  /** 这张卡自己的条目在周期内的实际占用时长 */
  ms: number;
}
export interface RecapNote { id: string; note: string; content: string; task: string; track: '主线' | '支线'; day: string; at: string }

export interface RecapMainline {
  permille: number;
  bySource: Record<RecapSource, number>;
}

export interface RecapPrevious {
  label: string; fromDay: string; toDay: string;
  /** 上一期有一部分早于最早的记录时不对比 */
  comparable: boolean;
  effectiveMs: number; mainPermille: number; done: number; notes: number;
}

export interface RecapResult {
  range: RecapRange;
  /** 有效投入：去掉待机 / 睡眠后的实际占用时长，并行只算一次（不随「含待机/睡眠」开关变） */
  effectiveMs: number;
  /** 有效天：有有效投入的活动日数 */
  activeDays: number;
  entryCount: number;
  mainline: RecapMainline;
  previous: RecapPrevious;
  unit: RecapUnit;
  buckets: RecapBucket[];
  /** 当前维度、当前开关下的合计（各组之和 = 各柱之和） */
  totalMs: number;
  series: RecapSeries[];
  groups: RecapGroup[];
  /** 上一期有、这期没有的组 */
  goneKeys: string[];
  done: RecapDoneCard[];
  notes: RecapNote[];
}

/** 回看页记住的选择（存在应用配置目录 recap-view.json，执行方案 E7）。 */
export interface RecapViewState {
  period: RecapPeriod; from: string | null; to: string | null;
  dim: RecapDimension; includeIdle: boolean; view: RecapView;
}
export const DEFAULT_RECAP_VIEW: RecapViewState = { period: 'week', from: null, to: null, dim: 'project', includeIdle: false, view: 'card' };

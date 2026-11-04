import type { CallerAgent } from './application.ts';

/*
 * 操作历史的公共合同（0.3.0-beta.3 E0.5，ADR 0019 修订 2）。
 * 这里只定类型和动作目录的骨架：记录 schema、比较与显示文字在 E8a2 补，服务入口的动作在 E8a3 逐个登记。
 */

/** 手动操作从哪个窗口发起；page 由调用页面传入，缺省按动作前缀推导（ADR 0019 第 5 条）。 */
export type ManualVia = 'main' | 'mini' | 'quickbar';
/** 软件按规则自己做的后台改动（ADR 0019 第 5 条「系统」）。 */
export type SystemTrigger = 'dayChange' | 'resume' | 'reconcile';

/**
 * 来源三类。自动化的 kind 取请求里 origin 的 mcp / cli；旧客户端没带 origin 时记 automation，
 * agent 为 `{ name: null, detected_by: 'none' }`（ADR 0019 第 6 条）。
 */
export type HistorySource =
  | { kind: 'manual'; via: ManualVia; page?: string }
  | { kind: 'system'; trigger: SystemTrigger }
  | { kind: 'mcp' | 'cli' | 'automation'; agent: CallerAgent };

/** 主体对象的类型（ADR 0019 第 4 条）。 */
export type HistorySubjectType = 'entry' | 'card' | 'task' | 'record' | 'review' | 'settings' | 'state';

/**
 * 动作目录里每个动作的声明：中文名、主体类型、主体怎么定位。
 * - param：取 intent.subject 里调用方给的 ID；
 * - result：取 work 的返回值（如新建条目、捕获待办在 work 里才生成 ID）；
 * - fixed：固定对象（如某个设置项）；
 * - none：没有单一主体，只记连带。
 */
export interface HistoryActionSpec {
  label: string;
  subject: HistorySubjectType | null;
  locate: 'param' | 'result' | 'fixed' | 'none';
}

/** 动作目录骨架。E8a3 按 `grep "run(ctx"` 的清单把全部服务入口登记进来。 */
export const historyActions = {
  'test.direct': { label: '测试直接提交', subject: null, locate: 'none' },
} as const satisfies Record<string, HistoryActionSpec>;

/** 开发预览与验证入口不进目录，用前缀区分（ADR 0019 第 5 条）。 */
export type HistoryActionId = keyof typeof historyActions | `dev.${string}` | `verification.${string}`;

/** 一次根事务的意图：动作、可选主体与来源。 */
export interface HistoryIntent {
  action: HistoryActionId;
  subject?: { type: HistorySubjectType; id: string };
  source?: HistorySource;
}

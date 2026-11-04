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

/* ---------- 记录格式（ADR 0019 第 2、4 条；E8a2） ---------- */

/** 改动所在对象的类型（主体与连带都用它）。 */
export type HistoryObjectType = 'entry' | 'card' | 'task' | 'record' | 'review' | 'settings' | 'state';

/**
 * 一项改动：对象、显示名、字段、改前改后的显示值。显示文字在写入时生成并保存（以后改了名字、删了对象也照样看得懂）。
 * 新建：before 为 null；删除：after 为 null。
 */
export interface HistoryChange {
  type: HistoryObjectType; id: string; name: string;
  field: string; before: string | null; after: string | null;
}

export interface HistorySubject { type: HistoryObjectType; id: string; text: string; meta: string }

/** 自动化调用的附加信息：方法、operation_id、规范化参数（上限 8 KB，超出截断并标记）。 */
export interface HistoryCall { method: string; operation_id: string; params: string; truncated: boolean }

export interface HistoryRecord {
  version: 1;
  id: string; at: string;
  /** 写入时按当时的日界算出的活动日；之后改了日界也不迁移，列表按它分组（审核 G6） */
  day: string;
  action: string; label: string;
  source: HistorySource;
  /** 系统来源的「为什么会改」 */
  why?: string;
  subject: HistorySubject | null;
  changes: HistoryChange[]; effects: HistoryChange[];
  /** 设置合并：合并了几次（≥ 2 才写）；全部来回时 reverted 为 true（「改回原值 ×N」） */
  merged?: number; reverted?: boolean;
  call?: HistoryCall;
}

export const HISTORY_PARAMS_LIMIT = 8 * 1024;
export const HISTORY_RETENTION_DAYS = 180;

/** 设置项的中文名（操作历史的显示）；没列的按键名显示。 */
export const SETTING_LABELS: Record<string, string> = {
  mainTasks: '主线任务数', sideTasks: '支线任务数', mainItems: '主线事项数', homeLayout: '首页布局', calendarSnapMinutes: '日历吸附',
  calendarShowIdle: '日历显示待机', betWeeks: '主线押注周数', dueSoonHours: '临近截止', timeboxDefaultMinutes: '时间盒默认时长',
  shrinkMaxLevel: '最多缩小几级', refusalThreshold: '拒绝次数阈值', refusalWindowMinutes: '拒绝计数窗口', refusalResetMinutes: '拒绝计数重置',
  inputHintWindowMinutes: '输入提示窗口', skipSignalCount: '跳过信号次数', subconsciousCount: '潜意识出卡数', ideaPoolLimit: '想法池上限',
  ideaExpireDays: '想法过期天数', reviewWeekday: '回顾日', dayBoundaryHour: '日界', longActivityMinutes: '长时间活动提醒',
  deadlineLeadMinutes: '截止提前提醒', offlineAskMinMinutes: '离线追问门槛', accent: '强调色', titleScale: '标题字号', topoMode: '等高线',
  topoDepth: '等高线深度', motion: '动效', quickbarHotkey: '快速记录条快捷键', mainHotkey: '主窗口快捷键', autostart: '开机自启',
  alwaysOnTop: '置顶', miniMode: '小窗口样式',
  'lists.presets': '收藏与快捷活动', 'lists.projects': '项目', 'lists.tags': '标签', 'lists.restPool': '休息池', 'lists.idleName': '待机名称',
};

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

const A = (label: string, subject: HistorySubjectType | null = null, locate: HistoryActionSpec['locate'] = subject ? 'none' : 'none'): HistoryActionSpec =>
  ({ label, subject, locate });
/**
 * 动作目录（E8a3）：每个改数据的服务入口一个动作。subject 为 null 时没有单一主体，全部改动都算 changes；
 * locate 为 none 时取这类对象里第一个有改动的作主体。动作名以「删除」开头的，界面用红字。
 */
export const historyActions = {
  'test.direct': A('测试直接提交'),
  // 首页、计时（homeService）
  'home.manual': A('补录', 'entry', 'result'), 'home.startPreset': A('开始收藏', 'entry'), 'home.beginPending': A('开始待确认', 'state'),
  'home.cancelPending': A('放弃待确认', 'state'), 'home.startFree': A('开始计时', 'entry'), 'home.startCard': A('开始卡片', 'card'),
  'home.draw': A('抽卡', 'card'), 'home.pause': A('暂停', 'entry'), 'home.stop': A('停止计时', 'entry'), 'home.insert': A('插入临时活动', 'entry'),
  'home.resume': A('继续', 'entry'), 'home.sleep': A('睡觉', 'entry'), 'home.wake': A('醒来', 'entry'), 'home.backfillRange': A('补录时段', 'entry'),
  'home.backfillSwitch': A('补记切换', 'entry'), 'home.answerOffline': A('说明离线时段', 'entry'), 'home.setReadout': A('改读数', 'entry'),
  'home.continueEntry': A('继续这一条', 'entry'), 'home.editMeta': A('改卡片项目和标签', 'card'), 'home.editOpen': A('改正在计时的内容', 'entry'),
  'home.commitReadout': A('改读数', 'entry'),
  // 小窗命令（dispatchMiniCommand）
  'mini.pause': A('暂停', 'entry'), 'mini.resume': A('继续', 'entry'), 'mini.complete': A('完成卡片', 'card'), 'mini.openMain': A('打开主窗口'),
  'mini.beginPending': A('开始待确认', 'state'), 'mini.cancelPending': A('放弃待确认', 'state'), 'mini.editOpen': A('改正在计时的内容', 'entry'),
  'mini.editCard': A('改卡片内容', 'card'), 'mini.setReadout': A('改读数', 'entry'),
  'mini.startFavorite': A('开始收藏', 'entry'), 'mini.startCard': A('开始卡片', 'card'), 'mini.continueEntry': A('继续这一条', 'entry'),
  // 卡片（cardService）
  'card.editContent': A('改卡片内容', 'card'), 'card.start': A('开始卡片', 'card'), 'card.complete': A('完成卡片', 'card'), 'card.shrink': A('缩小卡片', 'card'),
  'card.redraw': A('换一张', 'card'), 'card.pass': A('PASS', 'card'), 'card.leaveTo': A('离开去做', 'entry'),
  // 背包（backpackService）
  'backpack.createTask': A('新建任务', 'task'), 'backpack.freezeTask': A('冷藏任务', 'task'), 'backpack.abandonTask': A('放弃任务', 'task'),
  'backpack.restoreTask': A('放回背包', 'task'), 'backpack.addItem': A('加事项', 'card'), 'backpack.setDefaultProject': A('改任务的默认项目', 'task'),
  'backpack.saveCard': A('保存事项', 'card'), 'backpack.reorderQueue': A('调整事项顺序', 'card'),
  // 出卡、降级
  'deal.refresh': A('重新出卡', 'card'), 'deal.draw': A('抽卡', 'card'), 'degrade.returnFromRest': A('休息回来', 'state'),
  // 想法（ideaService）
  'idea.convertToTask': A('想法转任务', 'task'), 'idea.convert': A('想法转卡片', 'card'), 'idea.delete': A('删除想法', 'record'),
  'idea.edit': A('改想法', 'record'), 'idea.expire': A('想法进冷库', 'record'), 'idea.revive': A('从冷库捞回', 'record'), 'idea.resolveDuel': A('想法对决', 'record'),
  'idea.complete': A('完成想法', 'record'), 'idea.uncomplete': A('撤销完成想法', 'record'),
  // 收藏、项目、标签（presetService）
  'preset.addFavorite': A('新建收藏', 'settings'), 'preset.favorite': A('设为收藏', 'settings'), 'preset.editFavorite': A('改收藏', 'settings'),
  'preset.removeFavorite': A('删除收藏', 'settings'), 'preset.reorderFavorites': A('调整收藏顺序', 'settings'),
  'preset.createProject': A('新建项目', 'settings'), 'preset.createTag': A('新建标签', 'settings'),
  // 记录（recordService）
  'record.save': A('保存记录', 'record'), 'quickbar.capture': A('捕获待办', 'record'), 'quickbar.idea': A('保存想法', 'record'),
  // 回顾（reviewService）
  'review.enter': A('进入回顾', 'review'), 'review.goto': A('回顾下一步', 'review'), 'review.addIdea': A('回顾里加想法', 'record'),
  'review.duel': A('擂台对决', 'record'), 'review.takeCold': A('冷库捞取', 'record'), 'review.skipCold': A('跳过冷库', 'review'),
  'review.continueBet': A('继续押注', 'task'), 'review.switchMain': A('换主线', 'task'), 'review.finish': A('完成回顾', 'review'),
  // 设置（settingsService）
  'settings.change': A('改设置', 'settings'), 'settings.changeLists': A('改列表设置', 'settings'),
  // 日历、列表（timeEditService）
  'entry.create': A('新建计时条目', 'entry', 'result'), 'entry.update': A('调整条目时间', 'entry'), 'entry.move': A('移动条目', 'entry'),
  'entry.copy': A('复制条目', 'entry'), 'entry.patch': A('改条目', 'entry'), 'entry.remove': A('删除计时条目', 'entry'),
  'entry.setStart': A('改开始时间', 'entry'), 'entry.setEnd': A('改结束时间', 'entry'), 'entry.setDuration': A('改时长', 'entry'),
  'entry.setShowIdle': A('显示待机', 'settings'), 'entry.saveAsCard': A('存为卡', 'card'),
  // 系统（后台）
  'system.dayChange': A('活动日切换'), 'system.resume': A('补记离线时段', 'entry'), 'system.reconcile': A('整理记录'),
  // 自动化（MCP / CLI 的 11 个写方法）
  'auto.save_idea': A('保存想法', 'record'), 'auto.capture_todo': A('捕获待办', 'record'), 'auto.start_timer': A('开始计时', 'entry'),
  'auto.start_task_item': A('开始事项', 'card'), 'auto.pause_timer': A('暂停', 'entry'), 'auto.resume_timer': A('继续', 'entry'),
  'auto.stop_timer': A('停止计时', 'entry'), 'auto.start_break': A('开始临时活动', 'entry'), 'auto.return_from_break': A('回来', 'entry'),
  'auto.add_time_entry': A('补录条目', 'entry'), 'auto.complete_idea': A('完成想法', 'record'),
} as const satisfies Record<string, HistoryActionSpec>;

/** 系统来源的「为什么会改」（ADR 0019 第 5 条）。 */
export const SYSTEM_WHY: Record<SystemTrigger, string> = {
  dayChange: '到了新的活动日：过期的想法进冷库、到回顾日生成本周回顾、首页重新出卡',
  resume: '电脑休眠或关机后恢复：补记离线时段，截断当时正在计的那一条',
  reconcile: '启动或唤回主窗口时整理记录：补齐快速记录条存下的待办和想法',
};
/** 手动来源缺省的页面：按动作前缀推导（日历 / 列表共用的入口由调用页面传入）。 */
export const PAGE_OF_PREFIX: Record<string, string> = {
  home: 'home', card: 'home', deal: 'home', degrade: 'home', mini: 'mini', backpack: 'backpack', idea: 'backpack', preset: 'settings',
  record: 'home', review: 'review', settings: 'settings', entry: 'calendar', quickbar: 'quickbar',
};

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

// 设置页的 10 个分类（架构 §6 扩展 09 AI 与自动化）。数字的默认值、范围、步长都来自 shared/settings.ts，这里只放中文文案和用哪种控件。
// 「选卡规则自定义」放第二期，不在这里。
import type { SettingKey } from '../../shared/settings';

/** 一行设置：引用一个设置项；或者是自定义组件（列表编辑器、数据目录、AI 与自动化、关于）。 */
export type SettingRow =
  | { key: SettingKey; cn: string; desc?: string; control?: 'slider' | 'dropdown'; labels?: Record<string, string>;
      /** 只在某种计时模式下显示（ADR 0021 第 13 条） */
      onlyIn?: 'strict' | 'loose' }
  | { custom: 'idleName' | 'favorites' | 'presets' | 'restPool' | 'dataDir' | 'automation' | 'about'; cn: string; desc?: string };

export interface SettingGroup { cn: string; en: string; rows: SettingRow[] }
export interface SettingSection { id: string; no: string; cn: string; en: string; desc: string; groups: SettingGroup[] }

const hours = Object.fromEntries(Array.from({ length: 9 }, (_, h) => [String(h), `凌晨 ${h}:00`]));
const weekdays = { 1: '周一', 2: '周二', 3: '周三', 4: '周四', 5: '周五', 6: '周六', 7: '周日' };

export const SECTIONS: SettingSection[] = [
  { id: 'deal', no: '01', cn: '任务', en: 'QUESTS', desc: '任务池的上限、主线押多久。抽卡只从今日任务板里抽，按优先级（普通 1、高 3）和主线 1.5 倍的权重随机。', groups: [
    { cn: '任务池', en: 'TASK POOL', rows: [
      { key: 'mainTasks', cn: '主线任务最多几个', desc: '同时押注的主线任务数。调低时，已有的任务和事项不会被移出，只是不能再加新的' },
      { key: 'mainItems', cn: '每个主线任务下最多几项', desc: '新建、加一项时按这个数限制；缩小拆出来的不受限' },
      { key: 'sideTasks', cn: '支线任务最多几个', desc: '普通待办也是支线任务。满了要先做完、冷藏或放弃一个' },
      { key: 'betWeeks', cn: '主线押注期', desc: '到期那一周的回顾里加入主线复盘' } ] },
    { cn: '卡', en: 'CARDS', rows: [
      { key: 'timeboxDefaultMinutes', cn: '时间盒默认时长', desc: '新卡改成时间盒卡时的目标时长' } ] } ] },
  // 0.3.1：原来的 02 降级只剩缩小（不设上限）和主动休息（不计数），没有设置项了；这一节改放任务模式（ADR 0021 第 10 条），编号不变
  { id: 'quest', no: '02', cn: '任务模式', en: 'QUEST MODE', desc: '按任务卡的方式过一天：前一晚或早上把事排进今日任务板，犹豫时抽一张。不想要这一套，可以只用计时。', groups: [
    { cn: '任务模式', en: 'QUEST MODE', rows: [
      { key: 'taskMode', cn: '任务模式', desc: '关掉后只用计时：没有今日任务板、抽卡和背包里的任务，回顾里不押注主线。数据都留着，打开就回来' } ] } ] },
  { id: 'ideas', no: '03', cn: '想法与回顾', en: 'IDEAS', desc: '想法默认会「死」，死的意思是进冷库，不是删除。', groups: [
    { cn: '想法池', en: 'POOL', rows: [
      { key: 'ideaPoolLimit', cn: '想法池上限', desc: '平时可以暂时超出，回顾时用擂台压回' },
      { key: 'ideaExpireDays', cn: '自动进冷库', desc: '这么多天没动过的想法自动进冷库' } ] },
    { cn: '回顾', en: 'REVIEW', rows: [{ key: 'reviewWeekday', cn: '回顾日', desc: '这一天开始，顶栏「回顾」可以开始本周回顾', control: 'dropdown', labels: weekdays }] } ] },
  { id: 'timer', no: '04', cn: '计时', en: 'TIMER', desc: '任何时刻只有一项活动在计时；没在做事时记成待机。两种计时模式记的数据一样，只是显示和追问不同。', groups: [
    { cn: '基本', en: 'BASIC', rows: [
      { key: 'trackingMode', cn: '计时模式', desc: '紧凑：每一分钟都知道在做什么，待机照常显示，关机后追问。宽松：想记什么记什么，待机不显示，不追问',
        labels: { strict: '紧凑', loose: '宽松' } },
      { key: 'idleAskMinutes', cn: '空闲多久后追问', desc: '紧凑模式下，待机或暂停超过这个时长后开始下一件事，问一句刚才在做什么', onlyIn: 'strict' },
      { custom: 'idleName', cn: '待机名称', desc: '亮卡到点开始之间记成这个名字' },
      { key: 'dayBoundaryHour', cn: '日边界', desc: '几点算新的一天。凌晨完成的卡算前一天', control: 'dropdown', labels: hours } ] },
    { cn: '提醒', en: 'ALERTS', rows: [
      { key: 'longActivityMinutes', cn: '长时间提醒', desc: '同一活动超过这个时长，轻提醒确认一下' },
      { key: 'deadlineLeadMinutes', cn: '期限提醒提前量', desc: '带期限的待办，到期前多久提醒' },
      { key: 'offlineAskMinMinutes', cn: '离线追问最小间隔', desc: '关机或休眠短于这个时长，不追问，直接算在原来的活动上', onlyIn: 'strict' } ] } ] },
  { id: 'lists', no: '05', cn: '收藏与快捷活动', en: 'LISTS', desc: '收藏和快捷活动都是预设：描述、项目、标签。软件不预置，都由你自己添加。', groups: [
    { cn: '收藏', en: 'FAVORITES', rows: [{ custom: 'favorites', cn: '收藏', desc: '计时条下面一行，输入框没有焦点时按数字键 1–9 启动。做卡时点它是插入（卡等你回来），自由计时时是切换。计时条上点图钉、日历和列表里「设为收藏」也会加到这里' }] },
    { cn: '快捷活动', en: 'QUICK ACTIVITY', rows: [{ custom: 'presets', cn: '快捷活动', desc: '底栏弹层里一键开始。永远是插入：做完回到原来的事' }] } ] },
  { id: 'look', no: '06', cn: '外观', en: 'APPEARANCE', desc: '视觉风格固定，这里只调首页布局、强调色、字号和动效。', groups: [
    { cn: '首页', en: 'HOME', rows: [
      { key: 'homeLayout', cn: '首页布局', desc: '分开：上面一条计时条，下面是大卡。融合：计时条并进大卡，标题区就是输入框，项目和标签在卡的顶行，所有按钮在卡底部一排',
        labels: { split: '分开', fused: '融合' } },
      { key: 'insertBackPlace', cn: '插入卡的回去区域', desc: '做卡时插进别的事，插入卡边上那条「回到任务 / 结束原任务」放在哪一边', labels: { bottom: '底边', top: '顶边' } } ] },
    { cn: '颜色与字号', en: 'COLOR & TYPE', rows: [
      { key: 'accent', cn: '强调色', labels: { '#fffa00': '信号黄', '#00f5a0': '薄荷绿', '#20b8ff': '天青', '#ff7a1a': '警示橙' } },
      { key: 'titleScale', cn: '首页标题字号', desc: '在能放下的最大字号上再乘这个比例' } ] },
    { cn: '背景与动效', en: 'MOTION', rows: [
      { key: 'topoMode', cn: '等高线背景', labels: { dynamic: '动态', static: '静态', off: '纯色' } },
      { key: 'topoDepth', cn: '等高线深浅' },
      { key: 'motion', cn: '动效', desc: '系统开启「减少动态效果」时等于关闭', labels: { full: '完整', reduced: '简化', off: '关闭' } } ] } ] },
  { id: 'keys', no: '07', cn: '快捷键', en: 'HOTKEYS', desc: '全局快捷键在任何程序前台时都能用。和别的软件冲突时会提示，不会自动换。可以带 Win 键，但很多 Win 组合被系统占用，设好后按一下试试。', groups: [
    { cn: '全局', en: 'GLOBAL', rows: [
      { key: 'quickbarHotkey', cn: '快速记录条', desc: '再按一次或点别处就隐藏' },
      { key: 'mainHotkey', cn: '主窗口', desc: '从托盘唤回主窗口' } ] } ] },
  { id: 'window', no: '08', cn: '窗口与数据', en: 'WINDOW', desc: '程序常驻托盘，关闭窗口只是隐藏，计时继续。', groups: [
    { cn: '窗口', en: 'WINDOW', rows: [
      { key: 'autostart', cn: '开机自启' },
      { key: 'alwaysOnTop', cn: '主窗口置顶' },
      { key: 'miniMode', cn: '小窗口样式', desc: '小窗口显示项目、名称与进度格；mini窗口只保留单行名称、计时与按钮', labels: { mini: '小窗口', tiny: 'mini窗口' } } ] },
    { cn: '数据', en: 'DATA', rows: [{ custom: 'dataDir', cn: '数据目录', desc: 'Markdown + YAML，Obsidian、VS Code 都能直接打开' }] } ] },
  { id: 'automation', no: '09', cn: 'AI 与自动化', en: 'AUTOMATION', desc: '通过 MCP 协议或 CLI 命令行接入单轨，供 AI 客户端、自动化脚本与终端直接读写本机数据。',
    groups: [{ cn: 'AI 与自动化', en: 'AUTOMATION', rows: [{ custom: 'automation', cn: 'AI 与自动化' }] }] },
  { id: 'about', no: '10', cn: '关于', en: 'ABOUT', desc: '', groups: [{ cn: '关于', en: 'ABOUT', rows: [{ custom: 'about', cn: '关于' }] }] },
];

/** 英文单位小字。 */
export const UNIT_EN: Record<string, string> = {
  minutes: 'MIN', hours: 'H', days: 'DAYS', weeks: 'WEEKS', times: 'TIMES', items: 'ITEMS', levels: 'LV', slots: 'TASKS', '%': '%',
};

// 设置页的 9 个分类（架构 §6）。数字的默认值、范围、步长都来自 shared/settings.ts，这里只放中文文案和用哪种控件。
// 「选卡规则自定义」放第二期，不在这里。
import type { SettingKey } from '../../shared/settings';

/** 一行设置：引用一个设置项；或者是自定义组件（列表编辑器、数据目录、关于）。 */
export type SettingRow =
  | { key: SettingKey; cn: string; desc?: string; control?: 'slider' | 'dropdown'; labels?: Record<string, string> }
  | { custom: 'idleName' | 'quickActivities' | 'restPool' | 'dataDir' | 'about'; cn: string; desc?: string };

export interface SettingGroup { cn: string; en: string; rows: SettingRow[] }
export interface SettingSection { id: string; no: string; cn: string; en: string; desc: string; groups: SettingGroup[] }

const hours = Object.fromEntries(Array.from({ length: 9 }, (_, h) => [String(h), `凌晨 ${h}:00`]));
const weekdays = { 1: '周一', 2: '周二', 3: '周三', 4: '周四', 5: '周五', 6: '周六', 7: '周日' };

export const SECTIONS: SettingSection[] = [
  { id: 'deal', no: '01', cn: '出卡', en: 'DEAL', desc: '背包有几格、主线押多久、什么算快到期。选卡的优先级是固定的：阻塞 > 回顾 > 快到期 > 主线 > 支线 > 随机。', groups: [
    { cn: '背包', en: 'BACKPACK', rows: [
      { key: 'sideSlots', cn: '支线格数', desc: '调低时已经在背包里的项目不会被移出，只是不能再放新的' },
      { key: 'betWeeks', cn: '主线押注期', desc: '到期那一周的回顾里加入主线复盘' } ] },
    { cn: '出卡', en: 'CARDS', rows: [
      { key: 'dueSoonHours', cn: '快到期阈值', desc: '期限在这个时长以内的卡，排在主线和支线前面' },
      { key: 'timeboxDefaultMinutes', cn: '时间盒默认时长', desc: '新卡改成时间盒卡时的目标时长' } ] } ] },
  { id: 'degrade', no: '02', cn: '降级', en: 'DEGRADE', desc: '不想做眼前的事时，系统逐层降低要求。拒绝次数是状态探测器，不是惩罚。', groups: [
    { cn: '缩小', en: 'SHRINK', rows: [{ key: 'shrinkMaxLevel', cn: '缩小级数上限', desc: '按整条缩小链算。调低时已有的深层卡保留' }] },
    { cn: '休息', en: 'REST', rows: [
      { key: 'refusalThreshold', cn: '进入休息的拒绝次数', desc: '缩小和再抽一张合并计数' },
      { key: 'refusalWindowMinutes', cn: '计数窗口', desc: '在这段时间内累计到阈值就进入休息' },
      { key: 'refusalResetMinutes', cn: '计数清零', desc: '这段时间内没有再拒绝，计数清零' },
      { key: 'inputHintWindowMinutes', cn: '输入模式提醒', desc: '休息结束后这段时间内又达到阈值，就提醒换成输入' } ] },
    { cn: '信号', en: 'SIGNALS', rows: [
      { key: 'skipSignalCount', cn: '跳过信号', desc: '同一张卡被再抽一张跳过几次后提示拆小或 PASS' },
      { key: 'subconsciousCount', cn: '潜意识探测', desc: '同一个休息回答出现几次后，建议放进支线格' } ] } ] },
  { id: 'ideas', no: '03', cn: '想法与回顾', en: 'IDEAS', desc: '想法默认会「死」，死的意思是进冷库，不是删除。', groups: [
    { cn: '想法池', en: 'POOL', rows: [
      { key: 'ideaPoolLimit', cn: '想法池上限', desc: '平时可以暂时超出，回顾时用擂台压回' },
      { key: 'ideaExpireDays', cn: '自动进冷库', desc: '这么多天没动过的想法自动进冷库' } ] },
    { cn: '回顾', en: 'REVIEW', rows: [{ key: 'reviewWeekday', cn: '回顾日', desc: '这一天的活动日开始时，首页出回顾卡', control: 'dropdown', labels: weekdays }] } ] },
  { id: 'timer', no: '04', cn: '计时', en: 'TIMER', desc: '计时一直开着，任何时刻只有一项活动在计时。', groups: [
    { cn: '基本', en: 'BASIC', rows: [
      { custom: 'idleName', cn: '待机名称', desc: '亮卡到点开始之间记成这个名字' },
      { key: 'dayBoundaryHour', cn: '日边界', desc: '几点算新的一天。凌晨完成的卡算前一天', control: 'dropdown', labels: hours } ] },
    { cn: '提醒', en: 'ALERTS', rows: [
      { key: 'longActivityMinutes', cn: '长时间提醒', desc: '同一活动超过这个时长，轻提醒确认一下' },
      { key: 'deadlineLeadMinutes', cn: '期限提醒提前量', desc: '带期限的待办，到期前多久提醒' },
      { key: 'offlineAskMinMinutes', cn: '离线追问最小间隔', desc: '关机或休眠短于这个时长，不追问，直接算在原来的活动上' } ] } ] },
  { id: 'lists', no: '05', cn: '快捷活动与休息池', en: 'LISTS', desc: '软件不预置任何快捷活动和休息项，都由你自己添加。', groups: [
    { cn: '快捷活动', en: 'QUICK ACTIVITY', rows: [{ custom: 'quickActivities', cn: '快捷活动', desc: '底栏一键插入；结束后自动回到原来的卡。按使用频率排序' }] },
    { cn: '休息池', en: 'REST POOL', rows: [{ custom: 'restPool', cn: '休息池', desc: '进入休息时从这里派一件事。只是建议，不打勾、不计数' }] } ] },
  { id: 'look', no: '06', cn: '外观', en: 'APPEARANCE', desc: '视觉风格固定，这里只调强调色、字号和动效。', groups: [
    { cn: '颜色与字号', en: 'COLOR & TYPE', rows: [
      { key: 'accent', cn: '强调色', labels: { '#fffa00': '信号黄', '#00f5a0': '薄荷绿', '#20b8ff': '天青', '#ff7a1a': '警示橙' } },
      { key: 'titleScale', cn: '首页标题字号', desc: '在能放下的最大字号上再乘这个比例' } ] },
    { cn: '背景与动效', en: 'MOTION', rows: [
      { key: 'topoMode', cn: '等高线背景', labels: { dynamic: '动态', static: '静态', off: '纯色' } },
      { key: 'topoDepth', cn: '等高线深浅' },
      { key: 'motion', cn: '动效', desc: '系统开启「减少动态效果」时等于关闭', labels: { full: '完整', reduced: '简化', off: '关闭' } } ] } ] },
  { id: 'keys', no: '07', cn: '快捷键', en: 'HOTKEYS', desc: '全局快捷键在任何程序前台时都能用。和别的软件冲突时会提示，不会自动换。', groups: [
    { cn: '全局', en: 'GLOBAL', rows: [
      { key: 'quickbarHotkey', cn: '快速记录条', desc: '再按一次或点别处就隐藏' },
      { key: 'mainHotkey', cn: '主窗口', desc: '从托盘唤回主窗口' } ] } ] },
  { id: 'window', no: '08', cn: '窗口与数据', en: 'WINDOW', desc: '程序常驻托盘，关闭窗口只是隐藏，计时继续。', groups: [
    { cn: '窗口', en: 'WINDOW', rows: [
      { key: 'autostart', cn: '开机自启' },
      { key: 'alwaysOnTop', cn: '主窗口置顶' } ] },
    { cn: '数据', en: 'DATA', rows: [{ custom: 'dataDir', cn: '数据目录', desc: 'Markdown + YAML，Obsidian、VS Code 都能直接打开' }] } ] },
  { id: 'about', no: '09', cn: '关于', en: 'ABOUT', desc: '', groups: [{ cn: '关于', en: 'ABOUT', rows: [{ custom: 'about', cn: '关于' }] }] },
];

/** 英文单位小字。 */
export const UNIT_EN: Record<string, string> = {
  minutes: 'MIN', hours: 'H', days: 'DAYS', weeks: 'WEEKS', times: 'TIMES', items: 'ITEMS', levels: 'LV', slots: 'SLOTS', '%': '%',
};

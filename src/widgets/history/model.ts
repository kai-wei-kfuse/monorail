// 操作历史的显示规则（ADR 0019 第 8 条，执行方案 E8c；界面照 ../原型/页面/history-prototype.html）。纯函数，列表页和设置 09 共用。
import type { CallerAgent } from '../../shared/application';
import type { HistoryChange, HistoryObjectType, HistoryRecord, HistorySource } from '../../shared/history';
import { agentLabel } from '../../shared/agents';

/** 来源三类：自动化（MCP / CLI / 旧客户端）、手动（桌面端点的）、系统（软件按规则自己做的）。 */
export type SourceKind = 'auto' | 'manual' | 'system';
export const kindOf = (s: HistorySource): SourceKind => s.kind === 'manual' ? 'manual' : s.kind === 'system' ? 'system' : 'auto';
export const SRC_LABEL: Record<HistorySource['kind'], string> = { mcp: 'MCP', cli: 'CLI', automation: '自动化', manual: '手动', system: '系统' };
const PAGE_LABEL: Record<string, string> = { home: '首页', calendar: '日历', list: '列表', backpack: '背包', review: '回顾', settings: '设置' };
export const TRIGGER_LABEL = { dayChange: '活动日切换', resume: '休眠恢复', reconcile: '整理记录' } as const;
export const DETECTED_LABEL: Record<CallerAgent['detected_by'], string> = { mcp_handshake: 'MCP 握手', env: '环境变量', flag: '--agent 参数', none: '无' };

export const agentOf = (s: HistorySource): CallerAgent | null => 'agent' in s ? s.agent : null;
/** 调用方名字的样式：识别不到灰色，对照表里没有的用等宽字显示原始名字。 */
export const agentClass = (a: CallerAgent) => a.detected_by === 'none' ? 'unk' : a.name ? '' : 'raw';
export { agentLabel };

/** 来源徽标旁边的小字：主窗口 · 页面 / 小窗 / 快速记录条；系统写触发原因；自动化写调用方。 */
export function viaLabel(s: HistorySource): string {
  if (s.kind === 'manual') {
    if (s.via === 'mini') return '小窗';
    if (s.via === 'quickbar') return '快速记录条';
    return s.page && PAGE_LABEL[s.page] ? `主窗口 · ${PAGE_LABEL[s.page]}` : '主窗口';
  }
  if (s.kind === 'system') return TRIGGER_LABEL[s.trigger];
  return agentLabel(s.agent);
}
export const isDelete = (r: Pick<HistoryRecord, 'label'>) => r.label.startsWith('删除');

/**
 * 行里「主体与小字」：有主体就写主体；没有单一主体（如活动日切换）时，活动日切换写那一天，其余写第一个改动的对象，
 * 小字写共几项改动。
 */
export function rowSummary(r: HistoryRecord): { text: string; meta: string } {
  if (r.subject) return { text: r.subject.text || r.label, meta: r.subject.meta };
  const n = r.changes.length + r.effects.length, meta = n ? `${n} 项改动` : '';
  if (r.source.kind === 'system' && r.source.trigger === 'dayChange') {
    const [, m, d] = r.day.split('-').map(Number);
    return { text: `${m} 月 ${d} 日 周${WK[weekday(r.day)]}`, meta };
  }
  const first = r.changes[0] ?? r.effects[0];
  return { text: first ? first.name : r.label, meta };
}

/* ---------- 改动表 ---------- */

const TYPE_LABEL: Record<HistoryObjectType, string> = { entry: '条目', card: '卡片', task: '任务', record: '记录', review: '回顾', settings: '设置', state: '计时状态' };
const NEW_LABEL: Record<HistoryObjectType, string> = { entry: '新条目', card: '新卡片', task: '新任务', record: '新记录', review: '新回顾', settings: '新设置', state: '计时状态' };
/** 新建时作标题的字段（放进「」），其余字段的值用 · 接在后面；这些占位值不写。 */
const TITLE_FIELDS = new Set(['描述', '内容', '名称']);
// 「普通」是条目类型的缺省值，写出来只是噪音（插入、暂停才值得写）
const EMPTY = new Set(['（无标签）', '（无）', '（空）', '（不属于任务）', '（无描述）', '普通']);

export interface ChangeRow { field: string; before: string | null; after: string | null }

function summary(group: HistoryChange[], side: 'before' | 'after'): string {
  const title = group.find(c => TITLE_FIELDS.has(c.field))?.[side] ?? group[0].name;
  const rest = group.filter(c => !TITLE_FIELDS.has(c.field)).map(c => c[side]).filter((v): v is string => !!v && !EMPTY.has(v));
  return [`「${title}」`, ...rest].join(' · ');
}

/**
 * 把逐字段的改动排成表：新建的对象一行「新条目 — → 「名字」· 字段…」，删除的一行「条目「名字」… → 已删除」；
 * 其余逐字段，主体自己的字段只写字段名，别的对象写「条目「早饭」· 时间」。
 */
export function changeRows(changes: readonly HistoryChange[], subject?: { type: HistoryObjectType; id: string } | null): ChangeRow[] {
  const groups = new Map<string, HistoryChange[]>();
  for (const c of changes) { const k = `${c.type}\u0000${c.id}`; groups.set(k, [...(groups.get(k) ?? []), c]); }
  const rows: ChangeRow[] = [];
  for (const group of groups.values()) {
    const { type, name, id } = group[0], own = subject?.type === type && subject.id === id;
    if (type !== 'settings' && type !== 'state' && group.every(c => c.before === null)) { rows.push({ field: NEW_LABEL[type], before: null, after: summary(group, 'after') }); continue; }
    if (type !== 'settings' && type !== 'state' && group.every(c => c.after === null)) { rows.push({ field: `${TYPE_LABEL[type]}「${name}」`, before: summary(group, 'before'), after: null }); continue; }
    for (const c of group) {
      const field = own || type === 'settings' || type === 'state' ? c.field : `${TYPE_LABEL[type]}「${name}」· ${c.field}`;
      rows.push({ field, before: c.before, after: c.after });
    }
  }
  return rows;
}

/** 合并、改回原值的说明（设置 60 秒内连续改同一项合成一条，ADR 0019 第 3 条）。 */
export function mergeNote(r: Pick<HistoryRecord, 'merged' | 'reverted'>): string | null {
  if (!r.merged) return null;
  return r.reverted ? `1 分钟内连续改了 ${r.merged} 次，最后改回了原值。` : `1 分钟内连续改了 ${r.merged} 次，合成一条：只保留第一次的改前和最后一次的改后。`;
}

/* ---------- 调用 ---------- */

// CLI 调用在详情里写成实际命令（子命令与参数名照 cli/commands.ts；PowerShell 单引号引用）
const sq = (s: unknown) => `'${String(s).replace(/'/g, "''")}'`;
type P = Record<string, unknown>;
const tagFlags = (p: P) => (Array.isArray(p.tags) ? p.tags.map(t => ` --tag ${sq(t)}`).join('') : '') + (p.project ? ` --project ${sq(p.project)}` : '');
const CLI_CMD: Record<string, (p: P) => string> = {
  save_idea: p => `idea add ${sq(p.text)}${p.needs ? ` --needs ${sq(p.needs)}` : ''}`,
  capture_todo: p => `todo add ${sq(p.text)}${p.task_id ? ` --task-id ${p.task_id}` : ''}${p.due_at ? ` --due-at ${p.due_at}` : ''}${p.blocking ? ' --blocking' : ''}`,
  start_timer: p => `timer start ${sq(p.description)}${tagFlags(p)}`,
  start_task_item: p => `timer start-item ${p.card_id}`,
  pause_timer: () => 'timer pause', resume_timer: () => 'timer resume', stop_timer: () => 'timer stop',
  start_break: p => `break start ${sq(p.activity)}`, return_from_break: () => 'break return',
  add_time_entry: p => `time add ${sq(p.description)} --start ${p.start} --end ${p.end}${tagFlags(p)}`,
};

/** CLI 来源的调用还原成命令行；参数被截断或方法不认识时交回 null。 */
export function cliCommand(r: HistoryRecord): string | null {
  if (r.source.kind !== 'cli' || !r.call || r.call.truncated) return null;
  const build = CLI_CMD[r.call.method];
  if (!build) return null;
  let params: P;
  try { params = JSON.parse(r.call.params) as P; } catch { return null; }
  const a = r.source.agent;
  const flag = a.detected_by === 'flag' && a.evidence?.startsWith('--agent ') && a.name ? ` --agent ${sq(a.name)}` : '';
  return `node monorail-cli.mjs ${build(params)}${flag} --json`;
}
/** 原始参数：能解析就排版，截断的原样给出。 */
export function prettyParams(call: NonNullable<HistoryRecord['call']>): string {
  if (call.truncated) return call.params;
  try { return JSON.stringify(JSON.parse(call.params), null, 2); } catch { return call.params; }
}
/** 识别方式的说明文字（不含 HTML）。 */
export function detectionNote(a: CallerAgent): { lead: string; code?: string; tail?: string } {
  switch (a.detected_by) {
    case 'mcp_handshake': return { lead: 'MCP 握手 clientInfo：', code: `name = ${a.raw ?? ''}${a.version ? `，version = ${a.version}` : ''}`, tail: a.name ? undefined : '（对照表里没有，按原样显示）' };
    case 'env': return { lead: '检测到环境变量 ', code: a.evidence };
    case 'flag': return { lead: a.evidence?.startsWith('MONORAIL_AGENT') ? '设置了环境变量 ' : '命令里带了 ', code: a.evidence, tail: '（也可以用 MONORAIL_AGENT 环境变量）' };
    case 'none': return { lead: '没有握手信息、没有已知的 agent 环境变量，也没带 --agent。可能是直接在终端敲的命令，或没被识别的工具' };
  }
}

/* ---------- 筛选、搜索、分组 ---------- */

export type SourceFilter = 'all' | SourceKind;
export interface Filters { kind: SourceFilter; agent: string; q: string }

/** 搜索：动作、内容、来源、调用方、operation_id、方法名（只搜已载入的天数）。 */
export function matches(r: HistoryRecord, q: string): boolean {
  const s = q.trim().toLowerCase();
  if (!s) return true;
  const agent = agentOf(r.source);
  return [r.label, r.subject?.text ?? '', r.subject?.meta ?? '', r.call?.operation_id ?? '', r.call?.method ?? '', viaLabel(r.source),
    SRC_LABEL[r.source.kind], agent ? agentLabel(agent) : '', agent?.raw ?? ''].some(x => x.toLowerCase().includes(s));
}
export function filterRecords(records: readonly HistoryRecord[], f: Filters): HistoryRecord[] {
  return records.filter(r => (f.kind === 'all' || kindOf(r.source) === f.kind)
    && (f.kind !== 'auto' || f.agent === 'all' || agentLabel(agentOf(r.source)!) === f.agent) && matches(r, f.q));
}
export function sourceCounts(records: readonly HistoryRecord[]): Record<SourceFilter, number> {
  const out = { all: records.length, auto: 0, manual: 0, system: 0 };
  for (const r of records) out[kindOf(r.source)]++;
  return out;
}
export interface AgentOption { label: string; count: number; agent: CallerAgent }
/** 调用方下拉：按条数从多到少，「未识别」放最后。 */
export function agentOptions(records: readonly HistoryRecord[]): AgentOption[] {
  const map = new Map<string, AgentOption>();
  for (const r of records) {
    const a = agentOf(r.source); if (!a) continue;
    const label = agentLabel(a), cur = map.get(label);
    map.set(label, cur ? { ...cur, count: cur.count + 1 } : { label, count: 1, agent: a });
  }
  return [...map.values()].sort((x, y) => Number(x.agent.detected_by === 'none') - Number(y.agent.detected_by === 'none') || y.count - x.count || x.label.localeCompare(y.label));
}
/** 按记录里的 day 分组（写入时的活动日，之后改日界也不迁移），保持从新到旧。 */
export function groupByDay(records: readonly HistoryRecord[]): { day: string; records: HistoryRecord[] }[] {
  const out: { day: string; records: HistoryRecord[] }[] = [];
  for (const r of records) { const last = out.at(-1); if (last?.day === r.day) last.records.push(r); else out.push({ day: r.day, records: [r] }); }
  return out;
}
const WK = ['日', '一', '二', '三', '四', '五', '六'];
export const WK_EN = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const date = (day: string) => { const [y, m, d] = day.split('-').map(Number); return new Date(y, m - 1, d); };
const shift = (day: string, n: number) => { const t = date(day); t.setDate(t.getDate() + n); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`; };
export const weekday = (day: string) => date(day).getDay();
export function dayLabel(day: string, today: string): string {
  if (day === today) return '今天';
  if (day === shift(today, -1)) return '昨天';
  const t = date(day);
  return `${t.getMonth() + 1} 月 ${t.getDate()} 日 周${WK[t.getDay()]}`;
}
/** 设置 09 里的时刻：今天 / 昨天 / 11.06 加上 HH:mm。 */
export function whenLabel(r: Pick<HistoryRecord, 'day' | 'at'>, today: string): { prefix: string; time: string } {
  const d = new Date(r.at), time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const prefix = r.day === today ? '今天' : r.day === shift(today, -1) ? '昨天' : `${+r.day.slice(5, 7)}.${r.day.slice(8, 10)}`;
  return { prefix, time };
}
export function clockParts(at: string): { hm: string; s: string } {
  const d = new Date(at), p = (n: number) => String(n).padStart(2, '0');
  return { hm: `${p(d.getHours())}:${p(d.getMinutes())}`, s: p(d.getSeconds()) };
}

/* ---------- 定位 ---------- */

/** ◎ 跳到哪里：条目去日历（列表页的改动回列表），卡片、任务、记录去背包，回顾、设置去各自的页。 */
export type LocateTarget =
  | { page: 'calendar' | 'list'; entryId: string | null; day: string }
  | { page: 'backpack' | 'review' | 'settings' | 'home' };
export function locateOf(r: HistoryRecord): LocateTarget {
  const type = r.subject?.type ?? r.changes[0]?.type ?? r.effects[0]?.type ?? 'state';
  if (type === 'entry') {
    const entryId = r.subject?.type === 'entry' ? r.subject.id : r.changes.find(c => c.type === 'entry')?.id ?? null;
    return { page: r.source.kind === 'manual' && r.source.page === 'list' ? 'list' : 'calendar', entryId, day: r.day };
  }
  if (type === 'card' || type === 'task' || type === 'record') return { page: 'backpack' };
  if (type === 'review') return { page: 'review' };
  if (type === 'settings') return { page: 'settings' };
  return { page: 'home' };
}
export function locateLabel(t: LocateTarget): string {
  const name = { calendar: '日历', list: '列表', backpack: '背包', review: '回顾', settings: '设置', home: '首页' }[t.page];
  return 'day' in t ? `${name} · ${+t.day.slice(5, 7)}.${t.day.slice(8, 10)}` : name;
}

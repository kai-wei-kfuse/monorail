// 操作历史的语义比较（ADR 0019 第 4 条，执行方案 E8a2 第 3 条）：输入「本次改动前后」的数据，输出逐字段的改动
// 与显示文字。只处理本次改动过的对象，耗时与改动量成正比。纯函数：不读时钟、不改输入。
// 只有 domain/history 认识所有业务对象；其他 domain 单元不得引用它（eslint）。
import type { Card } from '../card/card';
import type { Task } from '../task/task';
import type { Review } from '../review/schedule';
import type { RecordEntry } from '../record/record';
import { ideaStatus } from '../idea/pool';
import type { TimeEntry } from '../timeline/entry';
import type { DayPlan, PlanItem } from '../plan/plan';
import type { HistoryChange, HistoryObjectType, HistorySubject } from '../../shared/history';
import { SETTING_LABELS } from '../../shared/history';

export interface Captured<T> { id: string; before: T | null; after: T | null }
export interface CompareInput {
  cards: Captured<Card>[]; tasks: Captured<Task>[]; reviews: Captured<Review>[]; records: Captured<RecordEntry>[];
  /** 改动过的活动日上，改前、改后的全部条目（按 id 配对，跨日移动也认得出） */
  entries: { before: TimeEntry[]; after: TimeEntry[] };
  state: { before: Record<string, unknown>; after: Record<string, unknown> };
  settings: { before: Record<string, unknown>; after: Record<string, unknown> };
  /** 今日任务板：本事务改过的那几天，改前、改后（ADR 0021 第 11 条）；没有就是空数组 */
  plans?: { before: DayPlan; after: DayPlan; today: string }[];
  /** 显示用：任务、卡片、条目的名字（改前改后合起来，删掉的也在） */
  names: { tasks: ReadonlyMap<string, string>; cards: ReadonlyMap<string, string>; entries: ReadonlyMap<string, string> };
}

const pad = (n: number) => String(n).padStart(2, '0');
const clock = (iso: string) => { const d = new Date(iso); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const md = (iso: string) => { const d = new Date(iso); return `${pad(d.getMonth() + 1)}.${pad(d.getDate())}`; };
const cut = (s: string, n = 60) => s.length > n ? `${s.slice(0, n - 1)}…` : s;
/** 条目时间的显示：11.04 15:00–15:30；正在计时写「至今」。 */
export const entryTime = (e: Pick<TimeEntry, 'started_at' | 'ended_at'>) => `${md(e.started_at)} ${clock(e.started_at)}–${e.ended_at ? clock(e.ended_at) : '至今'}`;
const tags = (list: readonly string[]) => list.length ? list.map(t => `#${t}`).join(' ') : '（无标签）';
const text = (v: unknown): string => {
  if (v === null || v === undefined || v === '') return '（空）';
  if (typeof v === 'boolean') return v ? '开' : '关';
  if (typeof v === 'string') return cut(v, 80);
  if (typeof v === 'number') return String(v);
  if (Array.isArray(v)) {
    if (!v.length) return '（空）';
    if (v.every(x => typeof x === 'string')) return cut(v.join('、'), 120);
    // 项目、预设这类对象列表：有名字就列名字
    if (v.every(x => x && typeof x === 'object' && typeof (x as { name?: unknown }).name === 'string')) return cut(v.map(x => (x as { name: string }).name).join('、'), 120);
  }
  return cut(JSON.stringify(v), 120);
};

/** 每类对象要比较哪些字段、怎么显示；没列出的字段是簿记（updated_at、history_logged_at 等），不算实质改动。 */
type Field<T> = [label: string, show: (x: T, names: CompareInput['names']) => string];
const ENTRY: Field<TimeEntry>[] = [
  ['描述', e => e.description || '（无描述）'], ['项目', e => e.project], ['标签', e => tags(e.tags)], ['时间', e => entryTime(e)],
  ['类型', e => e.kind], ['卡', (e, n) => e.card_id ? n.cards.get(e.card_id) ?? '（已删除的卡）' : '（无）'],
];
const CARD: Field<Card>[] = [
  ['内容', c => c.content], ['状态', c => c.status], ['任务', (c, n) => c.task_id ? n.tasks.get(c.task_id) ?? '（已删除的任务）' : '（不属于任务）'],
  ['项目', c => c.project ?? '（空）'], ['标签', c => tags(c.tags)], ['截止', c => c.due_at ? `${md(c.due_at)} ${clock(c.due_at)}` : '（无）'],
  ['类型', c => c.type], ['时间盒', c => c.timebox_minutes ? `${c.timebox_minutes} 分钟` : '（无）'], ['做到哪了', c => c.progress_note || '（空）'],
  ['缩小级数', c => String(c.shrink_level)], ['跳过次数', c => String(c.skip_count)],
];
const TASK: Field<Task>[] = [
  ['名称', t => t.name], ['状态', t => t.status], ['槽位', t => t.slot], ['押注到期', t => t.bet_ends_at ? md(t.bet_ends_at) : '（无）'],
  ['默认项目', t => t.default_project ?? '（无）'],
];
const REVIEW: Field<Review>[] = [['状态', r => r.status], ['步骤', r => r.step]];
const RECORD: Field<RecordEntry>[] = [
  ['内容', r => cut(r.text)], ['类型', r => r.kind], ['标签', r => tags(r.tags)],
  // ADR 0020：已完成存成冷库 + completed_at，历史里按状态显示「已完成」
  ['池', r => ideaStatus(r) ?? r.pool ?? '（无）'], ['需要', r => r.needs ?? '（无）'], ['截止', r => r.due_at ? `${md(r.due_at)} ${clock(r.due_at)}` : '（无）'],
  ['附件', r => r.attachments.length ? `${r.attachments.length} 个` : '（无）'],
];
/** 计时状态里算实质改动的字段（ADR 0019 第 1 条）；open_entry 的变化已经体现在条目上，pending、open_entry_day 等是簿记。 */
const STATE_FIELDS: Record<string, (v: unknown, n: CompareInput['names']) => string> = {
  current_card: (v, n) => typeof v === 'string' ? n.cards.get(v) ?? v : '（无）',
  resume_entry_id: (v, n) => typeof v === 'string' ? `回到「${n.entries.get(v) ?? '原来的事'}」` : '（无）',
  home_mode: v => ({ blank: '空卡区', task: '任务卡', guide: '引导', rest: '休息', review: '回顾' } as Record<string, string>)[String(v)] ?? String(v),
  rest: v => v && typeof v === 'object' ? `休息中${(v as { suggestion?: string | null }).suggestion ? `：${(v as { suggestion: string }).suggestion}` : ''}` : '（无）',
};

function objectChanges<T>(type: HistoryObjectType, items: Captured<T>[], fields: Field<T>[], nameOf: (x: T) => string, names: CompareInput['names']): HistoryChange[] {
  const out: HistoryChange[] = [];
  for (const { id, before, after } of items) {
    const name = cut(nameOf((after ?? before)!), 40);
    for (const [field, show] of fields) {
      const b = before === null ? null : show(before, names), a = after === null ? null : show(after, names);
      if (b !== a) out.push({ type, id, name, field, before: b, after: a });
    }
  }
  return out;
}

function settingsChanges(before: Record<string, unknown>, after: Record<string, unknown>): HistoryChange[] {
  const flat = (s: Record<string, unknown>) => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(s)) {
      if (k === 'lists' && v && typeof v === 'object') for (const [lk, lv] of Object.entries(v as Record<string, unknown>)) out[`lists.${lk}`] = lv;
      else out[k] = v;
    }
    return out;
  };
  const b = flat(before), a = flat(after), out: HistoryChange[] = [];
  for (const key of [...new Set([...Object.keys(b), ...Object.keys(a)])].sort()) {
    if (JSON.stringify(b[key]) === JSON.stringify(a[key])) continue;
    out.push({ type: 'settings', id: key, name: SETTING_LABELS[key] ?? key, field: SETTING_LABELS[key] ?? key, before: text(b[key]), after: text(a[key]) });
  }
  return out;
}

/** 全部实质改动。空数组 = 没有实质改动（只写了 receipt、只动了簿记字段、noop），这次提交不写历史。 */
export function compareAll(input: CompareInput): HistoryChange[] {
  const before = new Map(input.entries.before.map(e => [e.id, e])), after = new Map(input.entries.after.map(e => [e.id, e]));
  const entries: Captured<TimeEntry>[] = [...new Set([...before.keys(), ...after.keys()])].sort()
    .map(id => ({ id, before: before.get(id) ?? null, after: after.get(id) ?? null }));
  const state: HistoryChange[] = [];
  for (const [key, show] of Object.entries(STATE_FIELDS)) {
    const b = show(input.state.before[key] ?? null, input.names), a = show(input.state.after[key] ?? null, input.names);
    if (b !== a) state.push({ type: 'state', id: key, name: '计时状态', field: { current_card: '当前卡', resume_entry_id: '回到', home_mode: '首页', rest: '休息' }[key]!, before: b, after: a });
  }
  return [
    ...objectChanges('entry', entries, ENTRY, e => e.description || '（无描述）', input.names),
    ...objectChanges('card', input.cards, CARD, c => c.content, input.names),
    ...objectChanges('task', input.tasks, TASK, t => t.name, input.names),
    ...objectChanges('record', input.records, RECORD, r => r.text, input.names),
    ...objectChanges('review', input.reviews, REVIEW, r => r.period, input.names),
    ...state,
    ...settingsChanges(input.settings.before, input.settings.after),
    ...planChanges(input.plans ?? [], input.names),
  ];
}

/**
 * 今日任务板的改动（ADR 0021 第 11 条）：不加 change type 枚举值（0.3.0 的历史 schema 是严格枚举），
 * 板子上某张卡的变化记成 card、字段「今日任务板 / 今天的量 / 优先级 / 换一张」；「今天先不排」记成 state。
 * rolled_over、carried_from、carried_confirmed 是簿记；带过来的项在用户确认时（carried 从 true 变 false）记一条「今日任务板」。
 */
function planChanges(plans: NonNullable<CompareInput['plans']>, names: CompareInput['names']): HistoryChange[] {
  const out: HistoryChange[] = [];
  for (const { before, after, today } of plans) {
    const which = after.day === today ? '今天' : after.day > today ? '明天' : after.day;
    const b = new Map(before.items.map(i => [i.card_id, i])), a = new Map(after.items.map(i => [i.card_id, i]));
    const show = (i: PlanItem | undefined) => i ? (i.carried ? `${which}（带过来，待确认）` : which) : '—';
    for (const id of [...new Set([...b.keys(), ...a.keys()])].sort()) {
      const x = b.get(id), y = a.get(id), name = cut(names.cards.get(id) ?? '（已删除的卡）', 40);
      if (show(x) !== show(y)) out.push({ type: 'card', id, name, field: '今日任务板', before: show(x), after: show(y) });
      if (x && y) {
        const m = (i: PlanItem) => i.today_minutes === null ? '（不填）' : `${i.today_minutes} 分钟`;
        if (m(x) !== m(y)) out.push({ type: 'card', id, name, field: '今天的量', before: m(x), after: m(y) });
        if (x.priority !== y.priority) out.push({ type: 'card', id, name, field: '优先级', before: x.priority, after: y.priority });
      }
    }
    for (const id of after.seen.filter(id => !before.seen.includes(id)))
      out.push({ type: 'card', id, name: cut(names.cards.get(id) ?? '（已删除的卡）', 40), field: '换一张', before: null, after: '这一轮跳过' });
    if (before.skip_until_planned !== after.skip_until_planned)
      out.push({ type: 'state', id: `plan:${after.day}`, name: '今日任务板', field: '今天先不排', before: text(before.skip_until_planned), after: text(after.skip_until_planned) });
  }
  return out;
}

/**
 * 主体与连带（审核 G9）：主体那个对象的改动进 changes，其余进 effects。没有主体时全部算 changes。
 * subject 的显示文字取改动里的对象名；小字：条目写「项目 · 时间」，卡写所属任务。
 */
export function splitSubject(all: HistoryChange[], ref: { type: HistoryObjectType; id: string } | null,
  extra: { entries: ReadonlyMap<string, TimeEntry>; cards: ReadonlyMap<string, Card>; taskNames: ReadonlyMap<string, string> }):
  { subject: HistorySubject | null; changes: HistoryChange[]; effects: HistoryChange[] } {
  if (!ref) return { subject: null, changes: all, effects: [] };
  const is = (c: HistoryChange) => c.type === ref.type && c.id === ref.id;
  const own = all.filter(is), rest = all.filter(c => !is(c));
  let textOf = own[0]?.name ?? '', meta = '';
  if (ref.type === 'entry') { const e = extra.entries.get(ref.id); if (e) { textOf = e.description || '（无描述）'; meta = `${e.project} · ${entryTime(e)}`; } }
  if (ref.type === 'card') { const c = extra.cards.get(ref.id); if (c) { textOf = c.content; meta = c.task_id ? extra.taskNames.get(c.task_id) ?? '' : '不属于任务'; } }
  if (ref.type === 'settings') { textOf = SETTING_LABELS[ref.id] ?? ref.id; }
  if (!textOf && !own.length) return { subject: null, changes: all, effects: [] };
  return { subject: { type: ref.type, id: ref.id, text: cut(textOf, 60), meta }, changes: own, effects: rest };
}

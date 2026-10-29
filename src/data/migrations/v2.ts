import { parse, stringify } from 'yaml';
import type { FileSystem } from '../fs';
import { Journal, createWrite } from '../journal';
import { decode, encode } from '../frontmatter';
import { StateRepo } from './v1/stateRepo';
import { SettingsRepo } from './v1/settingsRepo';
import { cardSchema, recordSchema, reviewSchema, projectSchema, segmentSchema } from './v1/schemas';
import { migrateTimeline, auditTime } from './v2Timeline';
import { activityDay } from '../../domain/timeline/day';
import type { TimeEntry } from '../../domain/timeline/entry';

export interface MigrationOptions { now: string; id(): string }
export interface MigrationResult { migrated: boolean; backup: string | null; changes: string[] }
const mapped = (value: Record<string, unknown>, old: string, next: string): Record<string, unknown> => {
  const result = { ...value }; if (old in result) { result[next] = result[old]; delete result[old]; } return result;
};

export async function migrateV2(fs: FileSystem, options: MigrationOptions): Promise<MigrationResult> {
  const journal = new Journal(fs); await journal.recover();
  const stateFile = await fs.read('state.yaml');
  if (stateFile && (parse(stateFile.text) as { schemaVersion?: number })?.schemaVersion === 2) return { migrated: false, backup: null, changes: [] };
  const state = await new StateRepo(fs).read(), settings = await new SettingsRepo(fs).read();
  const paths = (await fs.list('', true)).filter(path => !/^(attachments|\.journal|backup)\//.test(path));
  const originals = new Map<string, string>();
  for (const path of paths) {
    const file = await fs.read(path); if (!file) throw new Error(`迁移源文件消失：${path}`);
    originals.set(path, file.text);
  }
  const backup = `backup/v1-${options.now.replace(/[:.]/g, '-')}-${options.id()}`;
  for (const [path, text] of originals) {
    await fs.atomicWrite(`${backup}/${path}`, text);
    if ((await fs.read(`${backup}/${path}`))?.text !== text) throw new Error(`备份验证失败：${path}`);
  }
  const docs = (directory: string) => [...originals].filter(([path]) => path.startsWith(`${directory}/`) && path.endsWith('.md'))
    .map(([path, text]) => ({ path, ...decode(text, path) }));
  const cards = docs('cards').map(doc => ({ ...doc, value: cardSchema.parse(doc.meta) }));
  const tasks = docs('projects').map(doc => ({ ...doc, value: projectSchema.parse(doc.meta) }));
  const records = docs('records').map(doc => ({ ...doc, value: recordSchema.parse(doc.meta) }));
  const reviews = docs('reviews').map(doc => ({ ...doc, value: reviewSchema.parse(doc.meta) }));
  const segments = [...originals].filter(([path]) => /^timelog\/.*\.md$/.test(path)).flatMap(([path, text]) => {
    const value: unknown = parse(text); if (!Array.isArray(value)) throw new Error(`${path}: invalid v1 timelog`);
    return value.map(row => segmentSchema.parse(row));
  });
  const rawOpen = segments.filter(segment => segment.ended_at === null);
  if (segments.some(segment => segment.seq > state.max_seq)) throw new Error('state.max_seq 落后于计时记录');
  if (rawOpen.length > 1 || (rawOpen[0]?.id ?? null) !== state.open_segment) throw new Error('v1 当前计时指针不一致');
  const entries = migrateTimeline(segments, state.open_segment, options.now, options.id);
  if (!state.open_segment) entries.push({ id: options.id(), started_at: options.now, ended_at: null,
    description: settings.lists.idleName, project: '待机', tags: [], card_id: null, kind: '普通', source: '自动', updated_at: options.now });
  auditTime(segments, entries, options.now, settings.dayBoundaryHour);
  const changes: string[] = [], output = new Map<string, string | null>();
  const taskIds = new Map<string, string>();
  const rootOf = (id: string): string => {
    const seen = new Set<string>(); let current = id;
    while (true) {
      if (seen.has(current)) throw new Error('缩小卡引用成环'); seen.add(current);
      const card = cards.find(card => card.value.id === current)?.value;
      if (!card) throw new Error(`缩小卡引用不存在：${current}`);
      if (!card.shrunk_from) return current; current = card.shrunk_from;
    }
  };
  for (const doc of tasks) {
    const old = doc.value, parked = old.slot === '不在背包';
    output.set(`tasks/${old.id}.md`, encode({ ...old, slot: parked ? '支线' : old.slot,
      status: parked && old.status === '进行中' ? '冷藏' : old.status, default_project: null }, doc.body));
    output.set(doc.path, null);
  }
  for (const doc of cards) {
    const root = cards.find(card => card.value.id === rootOf(doc.value.id))!.value;
    if (root.project_id) taskIds.set(doc.value.id, root.project_id);
    else {
      const taskId = `task-${root.id}`; taskIds.set(doc.value.id, taskId);
      if (!output.has(`tasks/${taskId}.md`)) {
        if (tasks.some(task => task.value.id === taskId)) throw new Error(`迁移任务 id 冲突：${taskId}`);
        output.set(`tasks/${taskId}.md`, encode({ id: taskId, name: root.content, slot: '支线', slot_index: null,
          status: root.status === '已完成' ? '已完成' : root.status === '已放弃' ? '已放弃' : '进行中',
          created_at: root.created_at, bet_ends_at: null, default_project: null }, ''));
      }
    }
  }
  let resume: TimeEntry | undefined;
  const resumeRef = rawOpen[0]?.kind === '插入' ? rawOpen[0].resume_card_id : null;
  if (resumeRef) resume = [...entries].reverse().find(entry => entry.card_id === resumeRef);
  for (const doc of cards) {
    const value = mapped(doc.value, 'project_id', 'task_id');
    value.task_id = taskIds.get(doc.value.id)!; value.project = null; value.tags = [];
    if (doc.value.id === resumeRef && !resume && doc.value.status === '进行中') {
      value.status = '待做'; changes.push(`card ${doc.value.id}: 进行中 -> 待做；恢复目标无有效时段`);
    }
    output.set(doc.path, encode(value, doc.body));
  }
  if (resumeRef && !resume) changes.push(`resume_entry_id: 原卡 ${resumeRef} 无有效时段，清空引用`);
  for (const doc of records) {
    const value = mapped(doc.value, 'project_id', 'task_id');
    if (value.pool === '已转待办') value.pool = '已转任务';
    output.set(doc.path, encode(value, doc.body));
  }
  for (const doc of reviews) {
    const value = mapped(mapped(doc.value, 'bet_project_ids', 'bet_task_ids'), 'timer_segment_id', 'timer_entry_id');
    if (value.timer_entry_id && !entries.some(entry => entry.id === value.timer_entry_id)) {
      changes.push(`review ${doc.value.id}: timer_entry_id ${value.timer_entry_id} 被完整覆盖，清空引用`); value.timer_entry_id = null;
    }
    output.set(doc.path, encode(value, doc.body));
  }
  for (const path of originals.keys()) if (/^timelog\/.*\.md$/.test(path)) output.set(path, null);
  const groups = new Map<string, TimeEntry[]>();
  for (const entry of entries) {
    const path = `timelog/${activityDay(entry.started_at, settings.dayBoundaryHour)}.md`;
    groups.set(path, [...(groups.get(path) ?? []), entry]);
  }
  for (const [path, rows] of groups) output.set(path, stringify(rows));
  const open = entries.find(entry => entry.ended_at === null)!;
  const nextState: Record<string, unknown> = { ...state, schemaVersion: 2, open_entry: open.id,
    open_entry_day: activityDay(open.started_at, settings.dayBoundaryHour),
    resume_entry_id: resume?.id ?? null, pending_at: null, pending_id: null, home_mode: state.home_mode === 'stopped' ? 'blank' : state.home_mode };
  for (const key of ['max_seq', 'open_segment', 'open_segment_day', 'stopped_day']) delete nextState[key];
  if (resumeRef && !resume && state.current_card === resumeRef) { nextState.current_card = null; nextState.home_mode = 'blank'; }
  output.set('state.yaml', stringify(nextState));
  const nextSettings: Record<string, unknown> = { ...settings, schemaVersion: 2, mainTasks: settings.mainSlots, sideTasks: 10, mainItems: 5,
    homeLayout: 'split', miniMode: 'mini', calendarSnapMinutes: 5, calendarShowIdle: true,
    lists: { ...settings.lists, presets: settings.lists.quickActivities.map(activity => ({ id: activity.id, name: activity.name, project: activity.category, tags: [], mode: '插入', place: '弹层' })),
      projects: [...new Set(segments.map(segment => segment.category))].filter(name => !['主线', '支线', '待机', '休息', '睡眠', '离线', '回顾'].includes(name)).map(name => ({ name, color: '#888888' })), tags: [] } };
  delete nextSettings.mainSlots; delete nextSettings.sideSlots;
  delete (nextSettings.lists as Record<string, unknown>).quickActivities;
  output.set('settings.yaml', stringify(nextSettings));
  const surviving = new Set(entries.map(entry => entry.id));
  for (const doc of cards) {
    const next = decode(output.get(doc.path)!, doc.path).meta;
    const allowedRelease = doc.value.id === resumeRef && !resume && doc.value.status === '进行中' && next.status === '待做';
    if (next.id !== doc.value.id || (next.status !== doc.value.status && !allowedRelease)) throw new Error(`迁移卡状态对账失败：${doc.value.id}`);
    if (!output.has(`tasks/${next.task_id}.md`)) throw new Error(`迁移任务引用不存在：${next.task_id}`);
  }
  for (const doc of reviews) {
    const ref = decode(output.get(doc.path)!, doc.path).meta.timer_entry_id;
    if (ref && !surviving.has(String(ref))) throw new Error(`迁移回顾引用不存在：${ref}`);
  }
  if (!surviving.has(String(nextState.open_entry)) || (nextState.resume_entry_id && !surviving.has(String(nextState.resume_entry_id)))) throw new Error('迁移计时指针对账失败');
  if (entries.filter(entry => entry.ended_at === null).length !== 1) throw new Error('迁移后必须正好一条在计时');
  output.set(`${backup}/迁移记录.md`, `# v1 → v2\n\n${changes.length ? changes.map(line => `- ${line}`).join('\n') : '无引用清空或卡状态例外。'}\n`);
  const writes = [...output].filter(([path, text]) => text !== (originals.get(path) ?? null)).map(([path, text]) => createWrite(path, text, originals.get(path) ?? null));
  await journal.run(options.id(), writes);
  return { migrated: true, backup, changes };
}

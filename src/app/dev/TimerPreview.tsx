import { useEffect, useState } from 'react';
import { formatReadout } from '../../shared/duration';
import { HitNote, TimeField } from '../../pages/home/TimeField';
import type { Cover, ReadoutNote, ReadoutOutcome, ReadoutRequest } from '../../pages/home/TimeField';
import { TimerBar } from '../../pages/home/TimerBar';
import type { EntryValue, TimerEntry } from '../../pages/home/TimerBar';
import { ManualForm } from '../../pages/home/ManualForm';
import { PresetRow } from '../../pages/home/PresetRow';
import { useHotkeys } from '../shell/hotkeys';
import { PREVIEW_PROJECTS, PREVIEW_TAGS } from './CalendarPreview';

const MIN = 60_000;
interface Entry { id: string; description: string; start: number; end: number | null }

/**
 * 读数就地编辑的预览（只在开发时用）：正在计「写周报」，前面紧挨着一条「学 408」。
 * 计时条的读数改的是这一条；卡上的读数改的是卡的「已用」，之前各段已计 30 分钟，少于 30 拒绝；小窗同计时条。
 * submit 是按计时系统规则简化的假实现：只往前挪当前这条的开始，盖到的先预览，确认凭据对上才改。
 */
export function TimerPreview() {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const [entries, setEntries] = useState<Entry[]>(() => {
    const t = Date.now();
    return [{ id: 'a', description: '学 408', start: t - 60 * MIN, end: t - 20 * MIN }, { id: 'b', description: '写周报', start: t - 20 * MIN, end: null }];
  });
  const [notes, setNotes] = useState<Record<string, ReadoutNote | null>>({});
  const open = entries.find(e => e.end === null)!, before = 30 * MIN;
  const cardTotal = before + (now - open.start);

  const submit = async (req: ReadoutRequest, seen: unknown): Promise<ReadoutOutcome> => {
    if (req.target.id !== open.id) return { kind: 'error', message: '已经换成别的事了，没有改' };
    if (req.milliseconds < 0) return { kind: 'error', message: '读数不能小于 0' };
    const at = Date.parse(req.at);
    if (req.target.mode === 'ref' && req.milliseconds < before) return { kind: 'error', message: `最少 ${before / MIN} 分钟（之前各段已计 ${before / MIN} 分钟）` };
    const start = at - (req.target.mode === 'ref' ? req.milliseconds - before : req.milliseconds);
    const hit: Cover[] = entries.filter(e => e.id !== open.id && e.start < open.start && (e.end ?? at) > start)
      .map(e => ({ id: e.id, description: e.description, from: new Date(Math.max(e.start, start)).toISOString(), to: new Date(Math.min(e.end ?? at, open.start)).toISOString() }));
    const plan = JSON.stringify({ start, hit });
    if (hit.length && seen !== plan) return { kind: 'confirm', hit, plan };
    setEntries(list => list.flatMap(e => e.id === open.id ? [{ ...e, start }] : e.end !== null && e.end > start
      ? (e.start >= start ? [] : [{ ...e, end: start }]) : [e]));
    return { kind: 'done', hit };
  };
  const field = (key: string, mode: 'entry' | 'ref', kind: 'hms' | 'mmss', shown: number) =>
    <TimeField id={key} kind={kind} shown={shown} target={() => ({ mode, id: open.id })} submit={submit}
      onNote={note => setNotes(n => ({ ...n, [key]: note }))}>{formatReadout(shown, kind)}</TimeField>;
  const note = (key: string) => notes[key] && <HitNote note={notes[key]!} />;
  const box = { padding: 24, border: '1px solid var(--line)', background: 'var(--paper)', display: 'grid', gap: 8 } as const;

  return <div style={{ padding: 32, display: 'grid', gap: 24, maxWidth: 900, font: '330 12px/1.5 var(--f-cn)' }}>
    <div style={box}>
      <span>计时条（时:分:秒，改这一条）· 正在计「{open.description}」</span>
      <b style={{ font: '600 30px/1 var(--f-en)' }}>{field('elapsed', 'entry', 'hms', now - open.start)}</b>
      <div style={{ minHeight: 18 }}>{note('elapsed')}</div>
    </div>
    <div style={box}>
      <span>卡上（分:秒，改卡的已用，之前各段 30 分钟）</span>
      <b style={{ font: '600 64px/1 var(--f-en)' }}>{field('card', 'ref', 'mmss', cardTotal)}</b>
      <div style={{ minHeight: 18 }}>{note('card')}</div>
    </div>
    <div style={{ ...box, width: 260, background: 'var(--ink)', color: 'var(--yellow)' }}>
      <span className="mini-time" style={{ font: '600 28px/1 var(--f-en)' }}>{field('mini', 'entry', 'mmss', now - open.start)}</span>
      <div style={{ minHeight: 18 }}>{note('mini')}</div>
    </div>
    <ol id="entries">{entries.map(e => <li key={e.id}>{e.description} {new Date(e.start).toTimeString().slice(0, 8)} – {e.end ? new Date(e.end).toTimeString().slice(0, 8) : '现在'}</li>)}</ol>
  </div>;
}

interface Row extends TimerEntry { end: number | null }
const iso = (t: number) => new Date(t).toISOString();

/**
 * 计时条预览（只在开发时用）：按原型 model.js 的规则做了个内存里的假计时系统，够点一遍待确认、写字开始、改这一条、
 * 暂停、继续、＋、读数、收藏（点、按数字键、拖动排序、图钉设为收藏）。规则以计时系统为准，这里只为看界面。下面列出所有条目和待确认，方便截图核对。
 */
export function TimerBarPreview() {
  const [mode, setMode] = useState<'timer' | 'manual'>('timer');
  const [draft, setDraft] = useState<string | null>(null);
  const [projects, setProjects] = useState(PREVIEW_PROJECTS), [tags, setTags] = useState(PREVIEW_TAGS);
  const [favs, setFavs] = useState<(EntryValue & { id: string })[]>([{ id: 'f1', description: '学 408', project: '学习', tags: ['408'] }, { id: 'f2', description: '回消息', project: '工作', tags: [] }]);
  const [prefill, setPrefill] = useState<EntryValue | null>(null);
  const [s, setS] = useState(() => {
    const t = Date.now(), row = (id: string, description: string, project: string, a: number, b: number | null): Row =>
      ({ id, description, project, tags: [], startedAt: iso(t - a * MIN), end: b === null ? null : t - b * MIN, cardId: null, kind: '普通' });
    return { rows: [row('r1', '学 408', '学习', 90, 40), row('r2', '待机', '待机', 40, null)], pending: null as { id: string; startedAt: string } | null,
      resume: null as string | null, drawn: false };
  });
  const open = s.rows.find(r => r.end === null)!;
  const idle = open.project === '待机';
  // 从 from 起开始一条新的：正在计的那条在 from 截断（整个在 from 之后的去掉），待确认清掉
  const start = (v: EntryValue & { cardId?: string | null }, from = Date.now()) => setS(x => ({ ...x, pending: null, resume: null,
    rows: [...x.rows.flatMap(r => r.end !== null ? [r] : Date.parse(r.startedAt) >= from ? [] : [{ ...r, end: from }]),
      { id: crypto.randomUUID(), ...v, cardId: v.cardId ?? null, kind: '普通' as const, startedAt: iso(from), end: null }] }));
  const take = () => s.pending ? Date.parse(s.pending.startedAt) : Date.now();
  const row = (id: string) => s.rows.find(r => r.id === id)!;
  // 收藏：计时时用它开始（从待确认的起点算），手动补录时用它填表
  const pick = (id: string) => { const f = favs.find(x => x.id === id); if (!f) return; const v = { description: f.description, project: f.project, tags: f.tags };
    if (mode === 'manual') setPrefill(v); else start(v, take()); };
  useHotkeys(Object.fromEntries(favs.slice(0, 9).map((f, i) => [String(i + 1), () => pick(f.id)])));
  const readout = async (req: ReadoutRequest): Promise<ReadoutOutcome> => {
    if (req.milliseconds < 0) return { kind: 'error', message: '读数不能小于 0' };
    const startAt = Date.parse(req.at) - req.milliseconds;
    if (req.target.mode === 'pending') { setS(x => ({ ...x, pending: x.pending && { ...x.pending, startedAt: iso(startAt) } })); return { kind: 'done', hit: [] }; }
    setS(x => ({ ...x, rows: x.rows.map(r => r.id === req.target.id ? { ...r, startedAt: iso(startAt) } : r) }));
    return { kind: 'done', hit: [] };
  };

  return <div style={{ padding: '24px 16px', display: 'grid', gap: 24 }}>
    <TimerBar mode={mode} onMode={setMode} onDraft={setDraft}
      manual={<ManualForm projects={projects} knownTags={tags}
        overlaps={(a, b) => s.rows.filter(r => r.project !== '待机' && Date.parse(r.startedAt) < Date.parse(b) && (r.end ?? Date.now()) > Date.parse(a))
          .map(r => ({ id: r.id, description: r.description, from: iso(Math.max(Date.parse(r.startedAt), Date.parse(a))), to: iso(Math.min(r.end ?? Date.now(), Date.parse(b))) }))}
        onAdd={(v, a, b) => setS(x => ({ ...x, rows: [...x.rows, { id: crypto.randomUUID(), ...v, cardId: null, kind: '普通' as const, startedAt: a, end: Date.parse(b) }]
          .sort((p, q) => Date.parse(p.startedAt) - Date.parse(q.startedAt)) }))}
        onCreateProject={name => setProjects(l => [...l, { name, color: '#16a085' }])} onCreateTag={t => setTags(l => [...l, t])} prefill={prefill} />}
      view={{ entry: open, idle, pending: s.pending, paused: idle && s.resume ? row(s.resume).description : null, waitingCard: s.drawn, canDraw: !s.drawn,
        projects, knownTags: tags, suggest: {
          favorites: favs.map(f => ({ id: f.id, name: f.description, project: f.project, tags: f.tags })),
          cards: [{ id: 'c1', content: '写周报', track: '主线' }, { id: 'c2', content: '改简历', track: '支线' }],
          recent: [...s.rows].reverse().map(r => ({ id: r.id, description: r.description, project: r.project, tags: r.tags })),
        } }}
      actions={{
        beginPending: () => setS(x => x.pending ? x : { ...x, pending: { id: crypto.randomUUID(), startedAt: iso(Date.now()) } }),
        cancelPending: id => setS(x => x.pending?.id === id ? { ...x, pending: null } : x),
        startFree: v => start(v, take()),
        editOpen: (id, patch) => setS(x => ({ ...x, rows: x.rows.map(r => r.id === id ? { ...r, ...patch } : r) })),
        pause: () => { const id = open.id; start({ description: '待机', project: '待机', tags: [] }); setS(x => ({ ...x, resume: id })); },
        resume: () => { const r = row(s.resume!); start({ description: r.description, project: r.project, tags: r.tags, cardId: r.cardId }); },
        draw: () => setS(x => ({ ...x, drawn: true, pending: x.pending ?? { id: crypto.randomUUID(), startedAt: iso(Date.now()) } })),
        startFavorite: pick,
        favorite: id => { const r = row(id); setFavs(l => [...l, { id: crypto.randomUUID(), description: r.description, project: r.project, tags: r.tags }]); },
        startCard: id => start({ description: id === 'c1' ? '写周报' : '改简历', project: '工作', tags: [], cardId: id }, take()),
        continueEntry: id => { const r = row(id); start({ description: r.description, project: r.project, tags: r.tags }, take()); },
        readout, createProject: name => setProjects(l => [...l, { name, color: '#16a085' }]), createTag: t => setTags(l => [...l, t]),
      }} />
    <PresetRow items={favs.map(f => ({ id: f.id, name: f.description, project: f.project, tags: f.tags, color: projects.find(p => p.name === f.project)?.color ?? 'var(--mute-2)' }))}
      onPick={pick} onReorder={ids => setFavs(l => ids.map(id => l.find(f => f.id === id)!))} />
    <div id="state" style={{ font: '330 12px/1.6 var(--f-cn)' }}>
      <div id="favs">收藏：{favs.map(f => f.description).join('、')}</div>
      <div>待确认：{s.pending ? new Date(s.pending.startedAt).toTimeString().slice(0, 8) : '无'} · 卡区照着显示：{draft ?? '（不在写）'}</div>
      <ol>{s.rows.map(r => <li key={r.id}>{r.description} [{r.project}{r.tags.map(t => ' #' + t).join('')}]{r.cardId ? ' 卡' : ''} {new Date(r.startedAt).toTimeString().slice(0, 8)} – {r.end ? new Date(r.end).toTimeString().slice(0, 8) : '现在'}</li>)}</ol>
    </div>
  </div>;
}

import { useEffect, useState } from 'react';
import { formatReadout } from '../../shared/duration';
import { HitNote, TimeField } from '../../pages/home/TimeField';
import type { Cover, ReadoutNote, ReadoutOutcome, ReadoutRequest } from '../../pages/home/TimeField';

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

import type { ReactNode } from 'react';
import { useRef, useState } from 'react';
import { formatReadout, parseReadout } from '../../shared/duration';
import type { ReadoutKind } from '../../shared/duration';
import './timer.css';

/** 被盖掉的一条（计时系统读数预览的 hit）：from、to 是相交的那一段。 */
export interface Cover { id: string; description: string; from: string; to: string }
/** 改的是哪一条：待确认的起点、正在计的条目，或这张卡的「已用」（id 都是点开读数时的那一条）。 */
export interface ReadoutTarget { mode: 'pending' | 'entry' | 'ref'; id: string }
/** 交给计时系统的请求。at 是按下回车的时刻，预览和确认以后的重算都按它算。 */
export interface ReadoutRequest { target: ReadoutTarget; milliseconds: number; at: string }
/**
 * 计时系统交回的结果：改好了（hit 是被截断的记录）；会盖掉别的记录、要先确认（plan 是确认凭据，原样带回去）；不合法。
 * 确认时重算出来的和 plan 对不上，计时系统会再交回一次 confirm。
 */
export type ReadoutOutcome =
  | { kind: 'done'; hit: Cover[] }
  | { kind: 'confirm'; hit: Cover[]; plan: unknown }
  | { kind: 'error'; message: string };
/** 读数下面那一行要显示的；confirm 带上两个按钮的回调。 */
export type ReadoutNote = Exclude<ReadoutOutcome, { kind: 'confirm' }> | { kind: 'confirm'; hit: Cover[]; ok: () => void; cancel: () => void };

/**
 * 读数直接可改（UI 规范 §11.4）：平时是按钮，点一下就地变成输入框，回车或点别处提交，Esc 不改。
 * 写法见 shared/duration 的 parseReadout。shown 是读数现在显示的值，children 是它平时的样子。
 * 点开时就向 target() 要改的是哪一条，编辑期间换成了别的事，提交时仍按记下的去核对。
 * 先预览、后提交：submit 交回 confirm 时，onNote 收到带〔确定〕〔取消〕的提示，点确定才带着 plan 再交一次。
 */
export function TimeField({ id, kind, shown, disabled, target, submit, onNote, children }:
  { id?: string; kind: ReadoutKind; shown: number; disabled?: boolean; target: () => ReadoutTarget | null;
    submit: (req: ReadoutRequest, seen: unknown) => Promise<ReadoutOutcome>; onNote: (note: ReadoutNote | null) => void; children: ReactNode }) {
  const [draft, setDraft] = useState<string | null>(null);
  const first = useRef(''), done = useRef(false), editing = useRef<{ target: ReadoutTarget; shown: number } | null>(null);

  const beginEdit = () => {
    const t = target();
    if (!t) return;
    editing.current = { target: t, shown };
    done.current = false; first.current = formatReadout(shown, kind); setDraft(first.current);
    onNote(null);
  };
  const send = async (req: ReadoutRequest, seen: unknown) => {
    const r = await submit(req, seen);
    onNote(r.kind === 'confirm' ? { kind: 'confirm', hit: r.hit, ok: () => void send(req, r.plan), cancel: () => onNote(null) } : r);
  };
  // 回车提交后输入框被卸掉，还会再收到一次失焦；done 保证只交一次
  const finish = (keep: boolean) => {
    if (done.current || !editing.current) return;
    done.current = true;
    const text = draft ?? '', { target: t, shown: was } = editing.current;
    editing.current = null; setDraft(null);
    if (!keep || text.trim() === first.current) return;
    const ms = parseReadout(text, kind, was);
    if (ms === null) return;
    if (!Number.isFinite(ms)) { onNote({ kind: 'error', message: `「${text.trim()}」认不出来：写 45、1:30、1h 30m 或 +10` }); return; }
    void send({ target: t, milliseconds: ms, at: new Date().toISOString() }, null);
  };

  if (draft === null) return <button type="button" id={id} className="time-btn" disabled={disabled}
    title={disabled ? '现在没有在计时，没有要改的时间' : '点一下直接改：45 = 45 分钟，+10 / -5 = 加减分钟，也认 1h 30m'}
    onClick={beginEdit}>{children}</button>;
  return <input id={id} className="time-in" value={draft} aria-label="新的读数" style={{ width: `${Math.max(4, draft.length + 1)}ch` }}
    ref={el => { if (el && !el.dataset.f) { el.dataset.f = '1'; el.focus(); el.select(); } }}
    onChange={e => setDraft(e.target.value)} onBlur={() => finish(true)}
    onKeyDown={e => {
      if (e.nativeEvent.isComposing) return;
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    }} />;
}

/** 被盖掉的记录写成一句话。只盖了几秒的也要说出来。 */
export const coverText = (hit: readonly Cover[]) => hit.map(x => {
  const m = Math.round((Date.parse(x.to) - Date.parse(x.from)) / 60_000);
  return `${x.description || '（没写内容）'} ${m ? `${m} 分钟` : '不到 1 分钟'}`;
}).join('，');

/** 改读数以后读数下面那一行：已调整 / 已截断；会盖掉别的记录，等确认；读数不合法。 */
export function HitNote({ note }: { note: ReadoutNote }) {
  if (note.kind === 'error') return <span className="tbar-warn" role="alert">{note.message}</span>;
  if (note.kind === 'confirm') return <span className="tbar-warn hit-ask" role="alert">将覆盖：{coverText(note.hit)}
    <span className="hit-acts"><button type="button" onClick={note.ok}>确定</button><button type="button" onClick={note.cancel}>取消</button></span></span>;
  return note.hit.length ? <span className="tbar-warn">已截断：{coverText(note.hit)}</span> : <span className="tbar-note">开始时间已调整</span>;
}

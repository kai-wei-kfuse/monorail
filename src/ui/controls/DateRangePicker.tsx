import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Button } from './Button';
import { cellClass, dayDisabled, dotDate, initialView, MONTH_EN, monthCells, pickDay, shiftMonth, spanDays } from './dateRange';
import type { RangeDraft } from './dateRange';
import './rangeControls.css';

const CAL = <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 3.5h11v10h-11zM2.5 6.5h11M5.5 1.5v3M10.5 1.5v3" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="M9.5 9h2.5v2.5H9.5z" fill="currentColor" /></svg>;
const CHEV = <svg viewBox="0 0 10 10" aria-hidden="true"><path d="M3 1.5 6.5 5 3 8.5" fill="none" stroke="currentColor" strokeWidth="1.6" /></svg>;
const WEEK = ['一', '二', '三', '四', '五', '六', '日'];

interface Props {
  from: string; to: string;
  /** 最早可选（最早记录所在的活动日）；最晚是今天 */
  minDay: string | null; today: string;
  open: boolean; onOpenChange: (open: boolean) => void;
  onApply: (from: string, to: string) => void;
}

/**
 * 自定义起止日期（UI 风格规范 §11.12）：触发按钮沿用下拉造型，弹层并排两个月。
 * 先点开始、再点结束（顺序不限），选结束前悬停预览；〔确定〕或回车生效，〔取消〕、Esc、点外部放弃。
 */
export function DateRangePicker(p: Props) {
  const box = useRef<HTMLDivElement>(null);
  const { open, onOpenChange } = p;
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) onOpenChange(false); };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open, onOpenChange]);
  return <div className="msel drp" ref={box}>
    <button type="button" className="msel-btn drp-btn" aria-haspopup="dialog" aria-expanded={open} aria-label="自定义起止日期" onClick={() => onOpenChange(!open)}>
      <span className="drp-v"><b>{dotDate(p.from)}</b><i>–</i><b>{dotDate(p.to)}</b></span><i className="chev">{CAL}</i>
    </button>
    {open && <RangePop {...p} />}
  </div>;
}

/** 弹层：每次打开重新挂载，草稿从当前起止开始。 */
function RangePop({ from, to, minDay, today, onOpenChange, onApply }: Props) {
  const [draft, setDraft] = useState<RangeDraft>({ from, to, anchor: null });
  const [view, setView] = useState(() => initialView(to, minDay, today));
  const [hover, setHover] = useState<string | null>(null), [end, setEnd] = useState(false);
  const pop = useRef<HTMLDivElement>(null);
  // 960 宽的窗口里从触发按钮左端弹出会超出面板（出现横向滚动），放不下时改成右端对齐
  useLayoutEffect(() => { const r = pop.current?.getBoundingClientRect(); if (r && r.right > window.innerWidth - 24) setEnd(true); }, []);
  const apply = () => { if (draft.to) { onOpenChange(false); onApply(draft.from, draft.to); } };
  const applyRef = useRef(apply); applyRef.current = apply;
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onOpenChange(false); }
      else if (e.key === 'Enter') { e.preventDefault(); applyRef.current(); }
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [onOpenChange]);
  const preview = draft.anchor && hover ? spanDays(draft.anchor, hover) : null;
  const count = preview ?? (draft.to ? spanDays(draft.from, draft.to) : null);
  const month = (ym: string, side: 'l' | 'r') => <div className="drp-m">
    <div className="drp-mh">
      {side === 'l' && <button type="button" className="drp-nav prev" aria-label="上个月" disabled={minDay !== null && ym <= minDay.slice(0, 7)} onClick={() => setView(v => shiftMonth(v, -1))}>{CHEV}</button>}
      <b>{ym.slice(0, 4)}<span>.</span>{ym.slice(5, 7)}</b><i>{MONTH_EN[+ym.slice(5, 7) - 1]}</i>
      {side === 'r' && <button type="button" className="drp-nav next" aria-label="下个月" disabled={ym >= today.slice(0, 7)} onClick={() => setView(v => shiftMonth(v, 1))}>{CHEV}</button>}
    </div>
    <div className="drp-grid">
      {WEEK.map((w, i) => <span key={w} className={`drp-w${i >= 5 ? ' we' : ''}`}>{w}</span>)}
      {monthCells(ym).map((day, i) => day === null ? <span key={`x${i}`} />
        : <button key={day} type="button" className={`drp-d ${cellClass(day, draft, today, hover)}`} disabled={dayDisabled(day, minDay, today)}
          onClick={() => setDraft(d => pickDay(d, day))} onPointerEnter={() => setHover(day)}>{+day.slice(8)}</button>)}
    </div>
  </div>;
  return <div ref={pop} className={`drp-pop${end ? ' end' : ''}`} role="dialog" aria-label="选择起止日期" onPointerLeave={() => setHover(null)}>
    <div className="drp-head">
      <div className={`drp-end${draft.anchor ? '' : ' on'}`}><span className="k">FROM<em>开始</em></span><b>{dotDate(draft.from)}</b></div>
      <i className="drp-arr" />
      <div className={`drp-end${draft.anchor ? ' on' : ''}`}><span className="k">TO<em>结束</em></span>{draft.to ? <b>{dotDate(draft.to)}</b> : <b className="wait">选结束日</b>}</div>
      <span className="drp-count">共<b>{count ?? '—'}</b>天</span>
    </div>
    <div className="drp-body">{month(view, 'l')}{month(shiftMonth(view, 1), 'r')}</div>
    <div className="drp-foot">
      <p>{draft.anchor ? '再点一天作为结束，先后顺序不限' : `点一天作为开始 · 可选 ${minDay ? dotDate(minDay) : '最早的记录'} 到今天`}</p>
      <Button size="sm" onClick={() => onOpenChange(false)}>取消</Button>
      <Button size="sm" tone="ink" disabled={!draft.to} onClick={apply}>确定</Button>
    </div>
  </div>;
}

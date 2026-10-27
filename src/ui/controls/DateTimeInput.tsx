import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Icon } from '../icons/Icon';
import { composeDateTime, formatDate, formatTime } from './localTime';
import './controls.css';

const MIN = 60_000, DAY = 86_400_000;

/**
 * 日期时间输入，精确到分钟。值是 ISO 字符串，空值为 null。
 * 自绘，不用浏览器原生的 datetime-local：日期、时间两格手写（「10/28」「明天」「18:30」），
 * 空着时旁边是「今天 / 明天」两个快捷键，有值后换成清除按钮（记录条一行放得下）。不弹日历，放在会随内容变高的小窗里也不会被裁掉。
 * 失焦或 Enter 时提交；写不对时边框变红，值不变。方向键：日期格 ±1 天，时间格 ±15 分钟。
 */
export function DateTimeInput({ value, onChange, label, inlineLabel }:
  { value: string | null; onChange: (iso: string | null) => void; label?: string; inlineLabel?: boolean }) {
  const [date, setDate] = useState(() => formatDate(value)), [time, setTime] = useState(() => formatTime(value));
  const [bad, setBad] = useState(false);
  const dateEl = useRef<HTMLInputElement>(null), timeEl = useRef<HTMLInputElement>(null);
  // 外面的值变了就重写两格文字，但正在输入的那一格不动（例如刚提交了日期、光标已经在时间格里）
  useEffect(() => {
    if (document.activeElement !== dateEl.current) setDate(formatDate(value));
    if (document.activeElement !== timeEl.current) setTime(formatTime(value));
    setBad(false);
  }, [value]);

  // 从输入框本身读当前文字：失焦可能紧跟在输入之后，状态还没来得及更新
  function commit() {
    const iso = composeDateTime(dateEl.current?.value ?? date, timeEl.current?.value ?? time);
    if (iso === undefined) { setBad(true); return; }
    setBad(false);
    if (iso !== value) onChange(iso);
    else { setDate(formatDate(value)); setTime(formatTime(value)); }
  }
  /** 今天 / 明天：保留已经写好的时间，没写就是 23:59。 */
  function pickDay(offset: number) {
    const now = new Date(), base = value ? new Date(value) : null;
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset, base?.getHours() ?? 23, base?.getMinutes() ?? 59);
    onChange(d.toISOString());
  }
  const step = (ms: number) => (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); return; }
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    const base = value ? Date.parse(value) : Date.parse(composeDateTime('今天', '') as string);
    const next = new Date(base + (e.key === 'ArrowUp' ? ms : -ms)).toISOString();
    setDate(formatDate(next)); setTime(formatTime(next)); onChange(next);
  };

  return <div className="dtw" role="group" aria-label={label} data-invalid={bad || undefined}>
    {inlineLabel && label && <span className="dt-k">{label}</span>}
    <input ref={dateEl} className="dt-seg dt-d" aria-label={`${label ?? ''}日期`} placeholder="月/日" value={date} inputMode="numeric"
      onChange={e => setDate(e.target.value)} onFocus={e => e.target.select()} onBlur={() => commit()} onKeyDown={step(DAY)} />
    <input ref={timeEl} className="dt-seg dt-t" aria-label={`${label ?? ''}时间`} placeholder="时:分" value={time} inputMode="numeric"
      onChange={e => setTime(e.target.value)} onFocus={e => e.target.select()} onBlur={() => commit()} onKeyDown={step(15 * MIN)} />
    {!value && <><button type="button" className="dt-q" onClick={() => pickDay(0)}>今天</button>
      <button type="button" className="dt-q" onClick={() => pickDay(1)}>明天</button></>}
    {value && <button type="button" className="dt-x" aria-label={`清除${label ?? ''}`} title="清除" onClick={() => onChange(null)}><Icon name="x" /></button>}
  </div>;
}

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PoolItem } from '../../../store/backpackSlice';
import { Segmented } from '../../../ui/controls/Segmented';
import { Button } from '../../../ui/controls/Button';
import { plainText } from '../../../ui/marks/MarkedText';
import { hm } from './TodayBoard';
import type { PlanDay } from './TodayBoard';

/**
 * 排进今天 / 明天的小浮层（UI 规范 §11.15）：优先〔普通 | 高〕；时间盒多一行「今天做 N 分钟」，默认剩下的时长；Enter 确认、Esc 取消。
 * anchor 是点的那个按钮，浮层放在它下面（放不下就放上面），坐标相对 host（抽屉）。
 */
export function PlanPopover({ item, taskName, day, due, anchor, host, onConfirm, onCancel }:
  { item: PoolItem; taskName: string | null; day: PlanDay; due: boolean; anchor: HTMLElement; host: HTMLElement;
    onConfirm: (priority: '普通' | '高', todayMinutes: number | null) => void; onCancel: () => void }) {
  const word = day === 'today' ? '今天' : '明天', box = useRef<HTMLDivElement>(null);
  const rest = item.type === '时间盒卡' ? Math.max(5, Math.ceil(((item.timeboxMinutes ?? 0) - item.elapsedMs / 60_000) / 5) * 5) : null;
  const [priority, setPriority] = useState<'普通' | '高'>('普通'), [minutes, setMinutes] = useState(rest ?? 0);
  const [pos, setPos] = useState({ left: 0, top: 0 });
  const ok = rest === null || (Number.isInteger(minutes) && minutes >= 5);
  const confirm = () => { if (ok) onConfirm(priority, rest === null ? null : minutes); };
  useLayoutEffect(() => {
    const h = host.getBoundingClientRect(), a = anchor.getBoundingClientRect(), p = box.current!.getBoundingClientRect();
    let x = a.left - h.left, y = a.bottom - h.top + 6;
    if (x + p.width > h.width - 8) x = h.width - p.width - 8;
    if (y + p.height > h.height - 8) y = a.top - h.top - p.height - 6;
    setPos({ left: Math.max(8, x), top: Math.max(8, y) });
  }, [anchor, host]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onCancel(); } };
    const away = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node) && e.target !== anchor) onCancel(); };
    document.addEventListener('keydown', key, true); document.addEventListener('pointerdown', away);
    return () => { document.removeEventListener('keydown', key, true); document.removeEventListener('pointerdown', away); };
  }, [onCancel, anchor]);
  return <div ref={box} className="bp-pop" role="dialog" aria-label={`排进${word}`} style={pos}
    onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); confirm(); } }}>
    <span className="k">PLAN · 排进{word}</span>
    <h4>{taskName ? `${taskName}：${plainText(item.content)}` : plainText(item.content)}</h4>
    {due && <div className="warn">这一项{word}到期。</div>}
    <div className="f">优先<small>标「高」的抽到概率是普通的 3 倍</small>
      <Segmented label="优先" value={priority} onChange={setPriority} options={[{ value: '普通', label: '普通' }, { value: '高', label: '高' }]} /></div>
    {rest !== null
      ? <div className="f">{word}做<span className="min"><input type="number" autoFocus aria-label={`${word}做多少分钟`} min={5} step={5} value={minutes}
            onChange={e => setMinutes(Math.round(Number(e.target.value) || 0))} /> 分钟</span>
          <small>默认是剩下的时长（{hm(rest)}）。{word}计够了就不再抽它，总进度照常累计。</small></div>
      : <div className="f"><small>结果卡不填时长，做完算达成。</small></div>}
    <div className="foot"><Button size="sm" onClick={onCancel}>取消</Button><Button size="sm" tone="ink" disabled={!ok} autoFocus={rest === null} onClick={confirm}>排进{word}</Button></div>
  </div>;
}

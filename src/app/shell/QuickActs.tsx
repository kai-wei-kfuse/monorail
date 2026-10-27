import { useEffect, useRef, useState } from 'react';
import type { IconName } from '../../ui/icons/Icon';
import { Icon } from '../../ui/icons/Icon';
import { ActTile, AddTile } from '../../ui/marks/ActTile';
import './shell.css';

export interface QuickAct { id: string; name: string; icon: IconName }

// 磁贴的英文小字跟着图标走；认不出的活动（通用图标）不写英文，免得写错
const EN: Partial<Record<IconName, string>> = { wc: 'RESTROOM', parcel: 'PARCEL', meal: 'MEAL', stretch: 'STRETCH' };

/**
 * 底栏的快捷活动：默认折叠，点开从底栏向上弹出，点外面就收起。
 * 固定首项是「睡觉」；其余按使用频率排好序传进来；快捷活动不预置，末尾是「＋ 添加快捷活动」（给了 onAdd 才显示）。
 * 选中一项会插入这项活动（结束后回到原来的卡），由 onPick 交给 timerService。
 */
export function QuickActs({ acts, current, onPick, onSleep, onAdd }:
  { acts: QuickAct[]; current: string | null; onPick: (id: string, at: string) => void; onSleep: (at: string) => void; onAdd?: () => void }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', esc); };
  }, [open]);
  const active = acts.find(a => a.id === current);
  const pick = (fn: () => void) => { fn(); setTimeout(() => setOpen(false), 650); };
  return <div ref={box}>
    <button type="button" className={`dock-toggle${active ? ' has-act' : ''}`} aria-expanded={open} onClick={() => setOpen(!open)}>
      <span className="chev"><Icon name="chev" /></span><span className="t-cn">快捷活动</span><span className="cnt">{active ? active.name : acts.length}</span>
    </button>
    {open && <div className="tray" role="dialog" aria-label="快捷活动">
      <div className="tray-head"><b>插入一项活动</b><span className="k">QUICK ACTIVITY</span><span>结束后自动回到原来的卡</span></div>
      <div className="tray-row">
        <ActTile icon="sleep" name="睡觉" en="SLEEP" onClick={() => pick(() => onSleep(new Date().toISOString()))} />
        {acts.map((a, i) => <ActTile key={a.id} icon={a.icon} name={a.name} en={EN[a.icon]} keys={i < 9 ? String(i + 1) : undefined} pressed={a.id === current}
          onClick={() => { const at = new Date().toISOString(); pick(() => onPick(a.id, at)); }} />)}
        {onAdd && <AddTile onClick={() => { setOpen(false); onAdd(); }} />}
      </div>
    </div>}
  </div>;
}

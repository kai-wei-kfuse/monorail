import { useEffect, useRef, useState } from 'react';
import type { IconName } from '../../ui/icons/Icon';
import { Icon } from '../../ui/icons/Icon';
import { ActTile } from '../../ui/marks/ActTile';
import { TextInput } from '../../ui/controls/TextInput';
import { Switch } from '../../ui/controls/Switch';
import { Button } from '../../ui/controls/Button';
import './shell.css';

export interface QuickAct { id: string; name: string; icon: IconName }

// 磁贴的英文小字跟着图标走；认不出的活动（通用图标）不写英文，免得写错
const EN: Partial<Record<IconName, string>> = { wc: 'RESTROOM', parcel: 'PARCEL', meal: 'MEAL', stretch: 'STRETCH' };

/**
 * 底栏的快捷活动：默认折叠，点开从底栏向上弹出，点外面就收起。
 * 固定首项是「睡觉」；其余按使用频率排好序传进来；快捷活动不预置。
 * 选中一项会插入这项活动（结束后回到原来的卡），由 onPick 交给 timerService。
 * 最后一行是临时活动（给了 onTemp 才显示）：写名字回车就插入，打开「存为快捷活动」才写进列表。
 */
export function QuickActs({ acts, current, onPick, onSleep, onTemp }:
  { acts: QuickAct[]; current: string | null; onPick: (id: string, at: string) => void; onSleep: (at: string) => void;
    onTemp?: (name: string, keep: boolean, at: string) => void }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    // 弹层开着时，数字键 1–9 启动弹层里的那几个（不在输入框里时）；拦下来，不再交给外壳启动收藏
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
      const i = /^[1-9]$/.test(e.key) && !e.ctrlKey && !e.altKey && !e.metaKey && !(e.target instanceof HTMLInputElement) ? +e.key - 1 : -1;
      if (i >= 0 && i < acts.length) { e.preventDefault(); e.stopPropagation(); pick(() => onPick(acts[i].id, new Date().toISOString())); }
    };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', esc); };
  }, [open, acts, onPick]);
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
      </div>
      {onTemp && <TempRow onSubmit={(name, keep) => { const at = new Date().toISOString(); pick(() => onTemp(name, keep, at)); }} />}
    </div>}
  </div>;
}

/** 弹层最后一行（原型的 .tray-temp）。跟着弹层卸载，下次打开是空的。 */
function TempRow({ onSubmit }: { onSubmit: (name: string, keep: boolean) => void }) {
  const [name, setName] = useState(''), [keep, setKeep] = useState(false);
  return <form className="tray-temp" onSubmit={e => { e.preventDefault(); if (name.trim()) onSubmit(name.trim(), keep); }}>
    <TextInput aria-label="临时活动" placeholder="直接写一项活动，回车就开始（临时的，不进列表）" value={name} onChange={e => setName(e.target.value)} />
    <span className="tray-keep"><Switch checked={keep} onChange={setKeep} label="存为快捷活动" /><span>存为快捷活动</span></span>
    <Button tone="ink" type="submit" disabled={!name.trim()}>开始</Button>
  </form>;
}

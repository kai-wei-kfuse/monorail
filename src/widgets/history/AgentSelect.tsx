import { Fragment, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { agentClass } from './model';
import type { AgentOption } from './model';
import { ChevIcon } from './HistoryRow';
import './history.css';

/**
 * 调用方筛选（只在「仅自动化」下出现）：调用方数量不固定，用下拉而不是分段按钮，窄窗口也不会撑出横向滚动。
 * 「全部调用方」在最上，按条数排，「未识别」放最后并用细线隔开。value 是显示名或 'all'。
 */
export function AgentSelect({ options, total, value, onChange }: { options: AgentOption[]; total: number; value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false), box = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);
  const cur = options.find(o => o.label === value);
  const pick = (v: string) => { onChange(v); setOpen(false); };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && open) { e.stopPropagation(); setOpen(false); } };
  return <span className="oh-ctl" onKeyDown={onKey}><span className="k">AGENT<em>调用方</em></span>
    <span className="oh-sel" ref={box}>
      <button type="button" className="oh-sel-btn" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(o => !o)}>
        <span className="lbl">{cur ? <><span className={agentClass(cur.agent)}>{cur.label}</span><b>{cur.count}</b></> : <><span>全部调用方</span><b>{total}</b></>}</span>
        <i className="chev"><ChevIcon /></i>
      </button>
      {open && <ul className="oh-sel-pop" role="listbox">
        <li role="option" aria-selected={value === 'all'} onClick={() => pick('all')}><span>全部调用方</span><b>{total}</b></li>
        {options.map(o => <Fragment key={o.label}>
          {o.agent.detected_by === 'none' && <li className="sep" aria-hidden="true" />}
          <li role="option" aria-selected={value === o.label} onClick={() => pick(o.label)}><span className={agentClass(o.agent)}>{o.label}</span><b>{o.count}</b></li>
        </Fragment>)}
      </ul>}
    </span></span>;
}

import { useState } from 'react';
import { Button } from '../../ui/controls/Button';
import { TextInput } from '../../ui/controls/TextInput';
import './settings.css';

export interface ListItem { id: string; name: string }

/**
 * 休息池的列表编辑器：名称、排序、删除、添加（预设用 PresetEditor）。
 * 每次改动都交出整份列表，由调用方保存。新项的 id 用 crypto.randomUUID()。
 */
export function ListEditor({ items, placeholder, onChange }:
  { items: ListItem[]; placeholder: string; onChange: (items: ListItem[]) => void }) {
  const [draft, setDraft] = useState('');
  const set = (i: number, patch: Partial<ListItem>) => onChange(items.map((it, n) => (n === i ? { ...it, ...patch } : it)));
  const move = (i: number, d: number) => { const next = [...items]; [next[i], next[i + d]] = [next[i + d], next[i]]; onChange(next); };
  const add = () => {
    const name = draft.trim();
    if (!name) return;
    onChange([...items, { id: crypto.randomUUID(), name }]);
    setDraft('');
  };
  return <div className="le">
    {items.length === 0 && <p className="ls-empty">还没有。软件不预置，用的时候自己加。</p>}
    {items.map((it, i) => <div key={it.id} className="le-row">
      <span className="le-no">{String(i + 1).padStart(2, '0')}</span>
      <TextInput aria-label="名称" value={it.name} onChange={e => set(i, { name: e.target.value })} />
      <Button size="sm" disabled={i === 0} aria-label="上移" onClick={() => move(i, -1)}>↑</Button>
      <Button size="sm" disabled={i === items.length - 1} aria-label="下移" onClick={() => move(i, 1)}>↓</Button>
      <Button size="sm" tone="danger" onClick={() => onChange(items.filter((_, n) => n !== i))}>删除</Button>
    </div>)}
    <div className="le-row le-add">
      <span className="le-no">＋</span>
      <TextInput aria-label="新加一项" placeholder={placeholder} value={draft} onChange={e => setDraft(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) add(); }} />
      <Button size="sm" tone="ink" disabled={!draft.trim()} onClick={add}>添加</Button>
    </div>
  </div>;
}

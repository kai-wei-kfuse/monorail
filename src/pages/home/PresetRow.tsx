import { useState } from 'react';
import { reorder } from './reorder';
import './timer.css';

export interface FavoriteView { id: string; name: string; project: string; color: string; tags: string[] }

/**
 * 计时条下面的收藏行（设计文档 §预设，方案 §7.3）：最多 9 个，前面的键帽是启动它的数字键（输入框没有焦点时按，由应用内快捷键接）。
 * 点一下：计时时用它开始，手动补录时用它填表，由页面决定。拖动排序，松手时交出新的顺序。
 */
export function PresetRow({ items, onPick, onReorder }: { items: FavoriteView[]; onPick: (id: string) => void; onReorder: (ids: string[]) => void }) {
  const [drag, setDrag] = useState<string | null>(null), [over, setOver] = useState<string | null>(null);
  const end = () => { setDrag(null); setOver(null); };
  // 往后拖会放在目标后面，提示条画在右边
  const ids = items.map(x => x.id), after = (id: string) => drag !== null && ids.indexOf(drag) < ids.indexOf(id);
  return <div className="fav-row" role="toolbar" aria-label="收藏">
    <span className="k">FAV<em>收藏</em></span>
    {items.length === 0 && <span className="fav-empty">还没有收藏。正在计的那条旁边点图钉，或者在日历、列表里「设为收藏」</span>}
    {items.slice(0, 9).map((p, i) => <button key={p.id} type="button" className={`fav${drag === p.id ? ' dragging' : ''}${over === p.id && drag !== p.id ? (after(p.id) ? ' over after' : ' over') : ''}`}
      draggable title={`${p.name} · ${p.project}${p.tags.map(t => ' #' + t).join('')}（按 ${i + 1} 启动，拖动排序）`}
      onClick={() => onPick(p.id)}
      onDragStart={e => { setDrag(p.id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', p.id); }}
      onDragOver={e => { if (drag) { e.preventDefault(); setOver(p.id); } }}
      onDragLeave={() => setOver(o => o === p.id ? null : o)}
      onDrop={e => { e.preventDefault(); if (drag && drag !== p.id) onReorder(reorder(ids, drag, p.id)); end(); }}
      onDragEnd={end}>
      <kbd>{i + 1}</kbd><i style={{ background: p.color }} /><span>{p.name}</span>
    </button>)}
  </div>;
}

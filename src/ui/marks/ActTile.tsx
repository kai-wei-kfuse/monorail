import type { MouseEvent } from 'react';
import type { IconName } from '../icons/Icon';
import { Icon } from '../icons/Icon';
import './marks.css';

/** 快捷活动磁贴 128×112：左上图标块，左下中文名加英文小字，右上键帽。选中时黑底、图标块变强调色。 */
export function ActTile({ icon, name, en, keys, pressed, onClick, onContextMenu }:
  { icon: IconName; name: string; en?: string; keys?: string; pressed?: boolean; onClick: () => void; onContextMenu?: (e: MouseEvent) => void }) {
  return <button type="button" className="qa" aria-pressed={pressed} onClick={onClick} onContextMenu={onContextMenu}>
    <span className="qi"><Icon name={icon} /></span>
    <b>{name}</b>{en && <i>{en}</i>}{keys && <kbd>{keys}</kbd>}
  </button>;
}

/** 「＋ 添加快捷活动」：快捷活动不预置，第一次展开时只有它。 */
export function AddTile({ label = '添加快捷活动', onClick }: { label?: string; onClick: () => void }) {
  return <button type="button" className="qa add" onClick={onClick}>
    <span className="qi"><Icon name="plus" /></span><b>{label}</b><i>ADD</i>
  </button>;
}

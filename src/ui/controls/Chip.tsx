import { Icon } from '../icons/Icon';
import './controls.css';

/** 标签片：#标签、筛选条件。on 时黑底；给了 onRemove 就带一个删除钮。 */
export function Chip({ label, on, onClick, onRemove }: { label: string; on?: boolean; onClick?: () => void; onRemove?: () => void }) {
  const cls = `chip${on ? ' on' : ''}`;
  const remove = onRemove && <button type="button" className="rm" aria-label={`移除 ${label}`} onClick={e => { e.stopPropagation(); onRemove(); }}><Icon name="x" /></button>;
  return onClick
    ? <span className={cls}><button type="button" aria-pressed={on} onClick={onClick}>{label}</button>{remove}</span>
    : <span className={cls}>{label}{remove}</span>;
}

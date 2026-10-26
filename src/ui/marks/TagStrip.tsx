import { Tri2 } from '../icons/Icon';
import './marks.css';

/**
 * 竖排黑色标签条（游戏相框）。no 是格号，例如「01」，散件传「散」。
 * card 版在卡片左边缘从顶部落下；mini 版是小窗左侧 24px 的缩小版。
 */
export function TagStrip({ label = 'SLOT', no, of, mini }: { label?: string; no: string; of?: string; mini?: boolean }) {
  const cn = /[^\x20-\x7e]/.test(no);
  if (mini) return <div className="vtab mini" aria-hidden="true"><b className={cn ? 'cn' : undefined}>{no}</b><Tri2 /></div>;
  return <div className="vtab" data-fx="vtab" aria-hidden="true">
    <span className="vt-t">{label}</span>
    <b className={cn ? 'cn' : undefined}>{no}</b>
    {of && <span className="vt-of">{of}</span>}
    <Tri2 />
    <i className="vt-hatch" />
  </div>;
}

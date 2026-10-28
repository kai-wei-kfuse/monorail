import { Icon } from '../../ui/icons/Icon';
import './shell.css';

/** 底栏的「开启小窗口」（UI 规范 §11.9）：和快捷活动同一种按钮。小窗是独立窗口，开着时按钮压下去，再点一下关掉。 */
export function MiniToggle({ on, onClick }: { on: boolean; onClick: () => void }) {
  return <button type="button" className="dock-toggle mini-toggle" aria-pressed={on} title="开关小窗口（M）" onClick={onClick}>
    <span className="chev"><Icon name={on ? 'shrink' : 'expand'} /></span><span className="t-cn">{on ? '关闭小窗口' : '开启小窗口'}</span>
  </button>;
}

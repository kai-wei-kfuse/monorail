import { Icon } from '../../ui/icons/Icon';
import './shell.css';

/**
 * 底栏的「开启小窗口 / 关闭小窗口」（UI 规范 §11.9）：和快捷活动同一种按钮。
 * on 是小窗真实的显示状态（miniWindow.subscribeVisibility），小窗自己点关闭、托盘开关都会跟着变；还不知道时是 null，按钮只写「小窗口」。
 */
export function MiniToggle({ on, onClick }: { on: boolean | null; onClick: () => void }) {
  return <button type="button" className="dock-toggle mini-toggle" aria-pressed={on ?? undefined} title="开关小窗口（M）" onClick={onClick}>
    <span className="chev"><Icon name={on ? 'shrink' : 'expand'} /></span><span className="t-cn">{on === null ? '小窗口' : on ? '关闭小窗口' : '开启小窗口'}</span>
  </button>;
}

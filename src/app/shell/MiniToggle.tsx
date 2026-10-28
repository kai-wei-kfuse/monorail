import { Icon } from '../../ui/icons/Icon';
import './shell.css';

/**
 * 底栏的小窗口开关（UI 规范 §11.9）：和快捷活动同一种按钮。点一下开、再点一下关。
 * 小窗也能从它自己的关闭按钮和托盘关掉，主窗口收不到通知，所以这里不显示开着还是关着，免得说错。
 */
export function MiniToggle({ onClick }: { onClick: () => void }) {
  return <button type="button" className="dock-toggle mini-toggle" title="开关小窗口（M）" onClick={onClick}>
    <span className="chev"><Icon name="expand" /></span><span className="t-cn">小窗口</span>
  </button>;
}

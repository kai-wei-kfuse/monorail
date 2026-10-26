import { Icon } from '../icons/Icon';
import './frame.css';

/** 窗口按钮：置顶 / 最小化 / 最大化或还原 / 关闭。只接收回调，不碰窗口 API。 */
export function WindowButtons({ pinned, maximized, onPin, onMinimize, onMaximize, onClose, closeTitle = '关闭（转到托盘，计时继续）' }:
  { pinned: boolean; maximized: boolean; onPin: () => void; onMinimize: () => void; onMaximize: () => void; onClose: () => void; closeTitle?: string }) {
  return <div className="winctl" data-in>
    <button type="button" className="wc pin" aria-pressed={pinned} aria-label="窗口置顶" title="窗口置顶" onClick={onPin}><Icon name="pin" /></button>
    <button type="button" className="wc" aria-label="最小化" title="最小化" onClick={onMinimize}><Icon name="min" /></button>
    <button type="button" className="wc" aria-label={maximized ? '还原' : '最大化'} title={maximized ? '还原' : '最大化'} onClick={onMaximize}>
      <Icon name={maximized ? 'restore' : 'max'} />
    </button>
    <button type="button" className="wc close" aria-label="关闭" title={closeTitle} onClick={onClose}><Icon name="x" /></button>
  </div>;
}

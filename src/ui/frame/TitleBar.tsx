import type { KeyboardEvent, ReactNode } from 'react';
import { Icon } from '../icons/Icon';
import './frame.css';

export interface TabItem { id: string; cn: string; en: string }

/**
 * 自绘标题栏：图标 · 名称 │ 页面标签 …… 右侧插槽（状态块、窗口按钮）。
 * 空白处带 data-tauri-drag-region：可以拖动，双击最大化 / 还原由 Tauri 处理。
 */
export function TitleBar({ name, tabs, active, onTab, inactive, children }:
  { name: string; tabs: TabItem[]; active: string; onTab: (id: string) => void; inactive?: boolean; children?: ReactNode }) {
  function onKey(e: KeyboardEvent) {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    const i = tabs.findIndex(t => t.id === active);
    onTab(tabs[(i + step + tabs.length) % tabs.length].id);
  }
  return <header className={`titlebar${inactive ? ' inactive' : ''}`} data-tauri-drag-region>
    <div className="brand" data-in data-tauri-drag-region><Icon name="logo" /><b data-tauri-drag-region>{name}</b></div>
    <nav className="tabs" role="tablist" data-in onKeyDown={onKey}>
      {tabs.map(t => <button key={t.id} type="button" role="tab" className="tab-btn" aria-selected={t.id === active}
        tabIndex={t.id === active ? 0 : -1} onClick={() => onTab(t.id)}>{t.cn}<i>{t.en}</i></button>)}
    </nav>
    <div className="tb-right" data-tauri-drag-region>{children}</div>
  </header>;
}

import type { ButtonHTMLAttributes } from 'react';
import type { IconName } from '../icons/Icon';
import { Icon } from '../icons/Icon';
import './controls.css';

type Native = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'>;

/** 首页 52px 大按钮：中文标签 + 英文小字 + 右端图标块。primary 是黑底主按钮。 */
export function ActionButton({ cn, en, icon, primary, compact, className = '', ...rest }:
  Native & { cn: string; en: string; icon: IconName; primary?: boolean; compact?: boolean }) {
  return <button type="button" {...rest} className={`abtn${primary ? ' go' : ''}${compact ? ' compact' : ''} ${className}`.trim()}>
    <span className="lbl"><b>{cn}</b><i>{en}</i></span>
    <span className="ico"><Icon name={icon} /></span>
  </button>;
}

/** 设置页、对话框里的 34px 小按钮。 */
export function Button({ tone = 'default', size = 'md', className = '', type = 'button', ...rest }:
  ButtonHTMLAttributes<HTMLButtonElement> & { tone?: 'default' | 'ink' | 'danger'; size?: 'md' | 'sm' }) {
  return <button type={type} {...rest} className={`sbtn${tone === 'default' ? '' : ' ' + tone}${size === 'sm' ? ' sm' : ''} ${className}`.trim()} />;
}

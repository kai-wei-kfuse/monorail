import { useRef, useState } from 'react';

/**
 * 点别处或回车才提交的输入格（列表行和日历弹窗共用，0.3.0-beta.3 D3）。
 * 平时显示 value；改了以后交给 onCommit；Esc 放弃；输入法组合中按键不算。没改（或只差首尾空白）不提交。
 * 提交后格子回到 value，由新数据刷新；改不了时调用方报错，格子自然回到原值。
 */
export function InlineCell({ className, label, value, readOnly, title, onCommit }:
  { className: string; label: string; value: string; readOnly?: boolean; title?: string; onCommit: (text: string) => void }) {
  const [text, setText] = useState<string | null>(null), skip = useRef(false);
  const commit = () => {
    if (!skip.current && text !== null && text.trim() !== value) onCommit(text.trim());
    skip.current = false; setText(null);
  };
  return <input className={className} aria-label={label} title={title} value={text ?? value} readOnly={readOnly} spellCheck={false}
    onChange={e => setText(e.target.value)} onBlur={commit}
    onKeyDown={e => {
      if (e.nativeEvent.isComposing) return;
      // 有改动时 Esc 只放弃这一格，不再往外传（例如日历弹窗的 Esc 关闭）；没改动时照常往外传
      if (e.key === 'Escape') { skip.current = true; if (text !== null) e.preventDefault(); }
      if (e.key === 'Enter' || e.key === 'Escape') (e.target as HTMLInputElement).blur();
    }} />;
}

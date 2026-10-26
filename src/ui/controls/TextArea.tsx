import type { TextareaHTMLAttributes } from 'react';
import { useLayoutEffect, useRef } from 'react';
import './controls.css';

/** 多行输入。autoGrow 时高度跟着内容变，最多 maxRows 行（快速记录条靠它变高）。 */
export function TextArea({ className = '', autoGrow, maxRows = 12, value, ...rest }:
  TextareaHTMLAttributes<HTMLTextAreaElement> & { autoGrow?: boolean; maxRows?: number }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!autoGrow || !el) return;
    const line = parseFloat(getComputedStyle(el).lineHeight) || 21;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, line * maxRows + 16) + 'px';
  }, [autoGrow, maxRows, value]);
  return <textarea ref={ref} rows={1} spellCheck={false} value={value} {...rest} className={`inp ${className}`.trim()} />;
}

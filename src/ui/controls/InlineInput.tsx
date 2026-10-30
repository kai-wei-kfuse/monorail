import type { CSSProperties } from 'react';
import { useLayoutEffect, useRef } from 'react';
import './controls.css';

export interface InlineInputProps {
  id?: string;
  className?: string;
  style?: CSSProperties;
  'aria-label'?: string;
  placeholder?: string;
  autoComplete?: string;
  value: string;
  onChange: (value: string) => void;
  onDone: (keep: boolean) => void;
}

/** 挂载时把焦点和光标放到文本末尾（不全选），后续 value 更新不再调用它。 */
export function focusInlineEnd(el: Pick<HTMLInputElement, 'value' | 'focus' | 'setSelectionRange'>): void {
  el.focus();
  const n = el.value.length;
  el.setSelectionRange(n, n);
}

/** 单次完成锁：先置 done = true 再调用 onDone，防止 Enter/Escape 卸载触发的同步 blur 二次进入。 */
export function createInlineGate(onDone: (keep: boolean) => void) {
  let done = false;
  const finish = (keep: boolean) => {
    if (done) return;
    done = true;
    onDone(keep);
  };
  return {
    finish,
    keyDown(e: { key: string; nativeEvent?: { isComposing?: boolean }; isComposing?: boolean; preventDefault(): void }) {
      if (e.nativeEvent?.isComposing || e.isComposing) return;
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    },
  };
}

/**
 * 点击切换式就地透明编辑框（卡片标题、小窗标题、时间读数共用）：
 * 仅在挂载时聚焦并将光标落于末尾；Enter 或失焦单次提交，Escape 取消；组字期间回车不提交。
 */
export function InlineInput({ id, className, style, 'aria-label': ariaLabel, placeholder, autoComplete = 'off', value, onChange, onDone }: InlineInputProps) {
  const ref = useRef<HTMLInputElement>(null);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const gate = useRef<ReturnType<typeof createInlineGate> | null>(null);
  if (!gate.current) gate.current = createInlineGate(keep => onDoneRef.current(keep));

  useLayoutEffect(() => {
    if (ref.current) focusInlineEnd(ref.current);
  }, []);

  return <input ref={ref} type="text" id={id} className={className ? `inline-in ${className}` : 'inline-in'}
    style={style} aria-label={ariaLabel} placeholder={placeholder} autoComplete={autoComplete} value={value}
    onChange={e => onChange(e.target.value)}
    onBlur={() => gate.current!.finish(true)}
    onKeyDown={e => gate.current!.keyDown(e)} />;
}

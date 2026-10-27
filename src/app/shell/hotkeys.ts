// 应用内快捷键。正在输入（输入框、文本框）或有对话框打开时不响应。
import { useEffect, useRef } from 'react';

export type HotkeyMap = Record<string, () => void>;

/** 把按键写成「Ctrl+,」「M」「1」这样的名字。 */
const name = (e: KeyboardEvent) => [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift',
  e.code.startsWith('Key') ? e.code.slice(3) : e.code.startsWith('Digit') ? e.code.slice(5) : e.key].filter(Boolean).join('+');

const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

export function useHotkeys(map: HotkeyMap) {
  const ref = useRef(map);
  ref.current = map;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || typing(e.target) || document.querySelector('.dlg-mask')) return;
      const fn = ref.current[name(e)];
      if (fn) { e.preventDefault(); fn(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

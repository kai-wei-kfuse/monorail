// 应用内快捷键。正在输入（输入框、文本框）或有对话框打开时不响应。
import { useEffect, useRef } from 'react';
import { formatHotkey } from '../../ui/controls/hotkey';

/** 键名和设置页录制快捷键同一种写法：「Ctrl+,」「M」「1」。带 Win 的组合写成「Win+1」，不会被当成「1」。 */
export type HotkeyMap = Record<string, () => void>;

const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

export function useHotkeys(map: HotkeyMap) {
  const ref = useRef(map);
  ref.current = map;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || typing(e.target) || document.querySelector('.dlg-mask')) return;
      const key = formatHotkey(e), fn = key === null ? undefined : ref.current[key];
      if (fn) { e.preventDefault(); fn(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

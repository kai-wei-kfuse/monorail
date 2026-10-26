export interface KeyLike { key: string; code: string; ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean }

const MODIFIERS = new Set(['Control', 'Alt', 'Shift', 'Meta']);

/** 把一次按键整理成「Ctrl+Alt+R」这种写法；只按了修饰键时返回 null。字母和数字取物理键位，不受输入法和 Shift 影响。 */
export function formatHotkey(e: KeyLike): string | null {
  if (MODIFIERS.has(e.key)) return null;
  const main = e.code.startsWith('Key') ? e.code.slice(3)
    : e.code.startsWith('Digit') ? e.code.slice(5)
    : e.code === 'Space' ? 'Space'
    : e.key.length === 1 ? e.key.toUpperCase() : e.key;
  return [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Win', main].filter(Boolean).join('+');
}

import { useState } from 'react';
import { formatHotkey } from './hotkey';
import './controls.css';

/** 点一下进入录制，按下组合键即保存；Esc 取消，Backspace 清空。冲突检查由调用方做。 */
export function HotkeyInput({ value, onChange, label }: { value: string; onChange: (value: string) => void; label?: string }) {
  const [rec, setRec] = useState(false);
  return <input readOnly className={`inp hk${rec ? ' rec' : ''}`} aria-label={label} value={rec ? '按下组合键…' : value || '未设置'}
    onFocus={() => setRec(true)} onBlur={() => setRec(false)}
    onKeyDown={e => {
      if (!rec || e.key === 'Tab') return;
      e.preventDefault();
      const done = (next?: string) => { if (next !== undefined) onChange(next); setRec(false); e.currentTarget.blur(); };
      if (e.key === 'Escape') return done();
      if (e.key === 'Backspace') return done('');
      const combo = formatHotkey(e);
      if (combo) done(combo);
    }} />;
}

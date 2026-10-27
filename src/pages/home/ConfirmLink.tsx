import { useEffect, useState } from 'react';

/**
 * 两步确认的小字链接：点一下变成 confirmLabel，ms 毫秒内再点一次才执行；超时或失焦就恢复原样。
 * 用在当天撤不回来的操作上，比如「今天不再出卡」。
 */
export function ConfirmLink({ label, confirmLabel, onConfirm, ms = 3000 }:
  { label: string; confirmLabel: string; onConfirm: (at: string) => void; ms?: number }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const id = setTimeout(() => setArmed(false), ms);
    return () => clearTimeout(id);
  }, [armed, ms]);
  return <button type="button" className="c-link" data-armed={armed || undefined} aria-live="polite" onBlur={() => setArmed(false)}
    onClick={() => { if (!armed) { setArmed(true); return; } setArmed(false); onConfirm(new Date().toISOString()); }}>
    {armed ? confirmLabel : label}
  </button>;
}

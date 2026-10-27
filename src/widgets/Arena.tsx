import { useEffect } from 'react';
import { Keycap } from '../ui/controls/Keycap';
import './review.css';

export interface DuelIdea { id: string; text: string; needs: string | null; lastTouchedAt: string; isNew: boolean }

const idle = (iso: string) => Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);

/**
 * 擂台对决：池子超出上限时，系统每次拿两个想法让我选左或右，没有「都要」；输的进冷库。
 * 不设次数上限，一直到池子回到上限以内。配对由 service 决定（优先让新想法挑战最久没动过的旧想法），这里只显示和回传。
 * 键盘 ← → 也能选。
 */
export function Arena({ left, right, over, onPick }:
  { left: DuelIdea; right: DuelIdea; over: number; onPick: (winnerId: string, loserId: string, at: string) => void }) {
  const pick = (w: DuelIdea, l: DuelIdea) => onPick(w.id, l.id, new Date().toISOString());
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') pick(left, right);
      else if (e.key === 'ArrowRight') pick(right, left);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });
  const card = (i: DuelIdea, other: DuelIdea, side: string, keys: string) =>
    <button type="button" className="idea-card" onClick={() => pick(i, other)}>
      <span className="k"><b>{side}</b>{i.isNew ? 'NEW 新想法' : `${idle(i.lastTouchedAt)} 天没动`}</span>
      <h4>{i.text}</h4>
      <p>{i.needs ? `需要：${i.needs}` : ' '}</p>
      <Keycap keys={keys} small />
    </button>;
  return <>
    <div className="duel">
      {card(left, right, 'LEFT', '←')}
      <span className="duel-vs" aria-hidden="true">VS</span>
      {card(right, left, 'RIGHT', '→')}
    </div>
    <p className="duel-foot">选一个留下，另一个进冷库（不是删除，随时可以捞回）。还要再淘汰<b>{over}</b>个。</p>
  </>;
}

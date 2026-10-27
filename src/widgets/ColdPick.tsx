import { Fragment, useState } from 'react';
import { Button } from '../ui/controls/Button';
import { Dialog } from '../ui/overlay/Dialog';
import './review.css';

export interface ColdIdea { id: string; text: string; needs: string | null; coldSince: string }

const ago = (iso: string) => Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);

/**
 * 从冷库捞回：每次拿出（最多）两个旧想法，可以带回一个、两个，或者都不要。
 * - 池子没满：直接入池；剩余空位不少于 2 个时两个都能带回，只剩 1 个空位时只能带回一个。
 * - 池子满了还要特地捞：只能带回一个，先确认一次；捞回的想法要和池中最弱的一个对决（擂台由 service 接着发起）。
 */
export function ColdPick({ offered, poolFree, onTake, onSkip }:
  { offered: ColdIdea[]; poolFree: number; onTake: (ids: string[], at: string) => void; onSkip: (at: string) => void }) {
  const [chosen, setChosen] = useState<string[]>([]), [confirm, setConfirm] = useState(false);
  const full = poolFree <= 0, max = full ? 1 : Math.min(2, poolFree);
  const toggle = (id: string) => setChosen(c => c.includes(id) ? c.filter(x => x !== id) : max === 1 ? [id] : [...c, id].slice(-max));
  const take = () => onTake(chosen, new Date().toISOString());
  if (!offered.length) return <p className="duel-foot">冷库是空的。</p>;
  return <>
    <div className="duel">
      {offered.map((i, n) => <Fragment key={i.id}>
        {n === 1 && <span className="duel-vs" aria-hidden="true">/</span>}
        <button type="button" className="idea-card" aria-pressed={chosen.includes(i.id)} onClick={() => toggle(i.id)}>
          <span className="k"><b>COLD</b>冷藏 {ago(i.coldSince)} 天</span>
          <h4>{i.text}</h4>
          <p>{i.needs ? `需要：${i.needs}` : ' '}</p>
        </button>
      </Fragment>)}
    </div>
    <div className="duel-foot">
      {full ? '想法池满了。特地捞回的想法要和池中最弱的一个对决。' : `想法池还有 ${poolFree} 个空位，选中的直接入池，最多带回 ${max} 个。`}
      <Button onClick={() => onSkip(new Date().toISOString())}>都不要</Button>
      <Button tone="ink" disabled={!chosen.length} onClick={() => (full ? setConfirm(true) : take())}>带回{chosen.length ? ` ${chosen.length} 个` : ''}</Button>
    </div>
    {confirm && <Dialog en="PULL BACK" title="池子满了，还要特地捞吗" onClose={() => setConfirm(false)}
      footer={<><Button onClick={() => setConfirm(false)}>算了</Button><Button tone="ink" onClick={() => { setConfirm(false); take(); }}>捞回并对决</Button></>}>
      捞回的想法会和池中最弱的一个对决，输的进冷库。
    </Dialog>}
  </>;
}

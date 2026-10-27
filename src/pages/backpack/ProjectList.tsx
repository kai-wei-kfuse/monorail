import { Button } from '../../ui/controls/Button';
import { Group } from '../../ui/layout/GroupTitle';
import type { ProjectView } from './types';
import './backpack.css';

const pad = (n: number) => String(n).padStart(2, '0');
const day = (iso: string) => { const d = new Date(iso); return `${d.getMonth() + 1} 月 ${d.getDate()} 日`; };

/**
 * 背包的格子：主线格（格号 01）和支线格（从 02 起），空格虚线；格号分配后固定，空出来的给下一个放进来的项目。
 * 下面是冷藏的项目，随时可以放回背包（有空格时）。已放弃的不显示。
 */
export function ProjectList({ projects, mainSlots, sideSlots, onNew, onSetMain, onFreeze, onAbandon, onRestore }:
  { projects: ProjectView[]; mainSlots: number; sideSlots: number;
    onNew: () => void; onSetMain: () => void; onFreeze: (id: string, at: string) => void; onAbandon: (p: ProjectView) => void; onRestore: (id: string, at: string) => void }) {
  const active = projects.filter(p => p.status === '进行中' && p.slot !== '不在背包');
  const mains = active.filter(p => p.slot === '主线'), sides = active.filter(p => p.slot === '支线');
  const parked = projects.filter(p => p.status === '冷藏' || (p.status === '进行中' && p.slot === '不在背包'));
  const freeMain = mains.length < mainSlots, freeSide = sides.length < sideSlots;
  const at = () => new Date().toISOString();
  // 空格的格号：主线 1..mainSlots，支线接在后面；已用的格号不再分配
  const used = new Set(active.map(p => p.slotIndex));
  const emptyNos = (from: number, count: number) => Array.from({ length: count }, (_, i) => from + i).filter(n => !used.has(n));
  const card = (p: ProjectView) => <div key={p.id} className={`slot${p.slot === '主线' ? ' main' : ''}`}>
    <div className="slot-no"><b>{pad(p.slotIndex ?? 0)}</b><span>{p.slot === '主线' ? 'MAIN' : 'SIDE'}</span></div>
    <div className="slot-body">
      <div><h4>{p.name}</h4><p>{p.openCards} 张待做{p.betEndsAt ? ` · 押注到 ${day(p.betEndsAt)}` : ''}</p></div>
      <div className="slot-acts"><Button size="sm" onClick={() => onFreeze(p.id, at())}>冷藏</Button><Button size="sm" tone="danger" onClick={() => onAbandon(p)}>放弃</Button></div>
    </div>
  </div>;
  const empty = (no: number, main: boolean) => <div key={'e' + no} className="slot empty">
    <div className="slot-no"><b>{pad(no)}</b><span>{main ? 'MAIN' : 'SIDE'}</span></div>
    <div className="slot-body">{main ? <><p>还没有主线</p><Button size="sm" tone="ink" onClick={onSetMain}>设定主线</Button></> : <p>空格</p>}</div>
  </div>;
  return <>
    <Group cn="背包" en="BACKPACK">
      <div className="slots">
        {mains.map(card)}{emptyNos(1, mainSlots).slice(0, mainSlots - mains.length).map(n => empty(n, true))}
        {sides.map(card)}{emptyNos(mainSlots + 1, Math.max(sideSlots, sides.length)).slice(0, Math.max(0, sideSlots - sides.length)).map(n => empty(n, false))}
      </div>
      <div className="bp-tools"><Button tone="ink" onClick={onNew}>新建项目</Button>
        <span className="bp-cnt">{!freeMain && !freeSide ? '背包满了：要开新坑，先冷藏或放弃一个' : ''}</span></div>
    </Group>
    <Group cn="冷藏" en="PARKED">
      {parked.length === 0 ? <p className="bp-empty">没有冷藏的项目。冷藏的项目不进想法池，也不占想法池的上限。</p>
        : <ul className="bp-list">{parked.map(p => <li key={p.id} className="bp-item">
          <div><b>{p.name}</b><div className="bp-meta">{p.status === '冷藏' ? '冷藏中' : '没放进背包'} · {p.openCards} 张待做</div></div>
          <div className="bp-acts"><Button size="sm" disabled={!freeSide && !freeMain} title={!freeSide && !freeMain ? '背包满了' : undefined}
            onClick={() => onRestore(p.id, at())}>放回背包</Button></div>
        </li>)}</ul>}
    </Group>
  </>;
}

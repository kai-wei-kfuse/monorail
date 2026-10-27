import { useState } from 'react';
import { Dialog } from '../ui/overlay/Dialog';
import { Button } from '../ui/controls/Button';
import { Segmented } from '../ui/controls/Segmented';
import { TextInput } from '../ui/controls/TextInput';
import './forms.css';

export interface SlotProject { id: string; name: string; slot: '主线' | '支线'; slotIndex: number }
export type ProjectSlot = '主线' | '支线' | '不在背包';
export interface ProjectDraft { name: string; slot: ProjectSlot; makeRoom: { id: string; action: '冷藏' | '放弃' } | null }

/**
 * 新建项目 / 设定主线。背包满了还想开新坑，必须先把一个旧的冷藏或放弃（满格规则）。
 * mode 'setMain' 用于「设定主线」引导卡和回顾里的「换主线」：直接放进主线格。
 * 选冷藏还是放弃交给调用方执行；这里只收集选择。
 */
export function ProjectDialog({ mode, inBackpack, mainFree, sideFree, onSave, onCancel }:
  { mode: 'new' | 'setMain'; inBackpack: SlotProject[]; mainFree: boolean; sideFree: boolean;
    onSave: (draft: ProjectDraft, at: string) => void; onCancel: () => void }) {
  const [name, setName] = useState(''), [slot, setSlot] = useState<ProjectSlot>(mode === 'setMain' || mainFree ? '主线' : sideFree ? '支线' : '不在背包');
  const [room, setRoom] = useState<ProjectDraft['makeRoom']>(null);
  const full = slot === '主线' ? !mainFree : slot === '支线' ? !sideFree : false;
  const candidates = inBackpack.filter(p => p.slot === slot);
  const ok = name.trim().length > 0 && (!full || room !== null);
  const save = () => { if (ok) onSave({ name: name.trim(), slot, makeRoom: full ? room : null }, new Date().toISOString()); };
  return <Dialog en={mode === 'setMain' ? 'SET MAINLINE' : 'NEW PROJECT'} title={mode === 'setMain' ? '设定主线' : '新建项目'} onClose={onCancel}
    footer={<><Button onClick={onCancel}>取消</Button><Button tone="ink" disabled={!ok} onClick={save}>{full ? '腾出位置并放入' : '放入'}</Button></>}>
    <div className="fm">
      <div className="fm-f">
        <label htmlFor="proj-name">项目名</label>
        <TextInput id="proj-name" autoFocus value={name} placeholder="一个正在推进的大方向，例如找工作" onChange={e => setName(e.target.value)} />
      </div>
      {mode === 'new' && <div className="fm-f"><span>放在哪</span>
        <Segmented label="放在哪" value={slot} onChange={v => { setSlot(v); setRoom(null); }}
          options={[{ value: '主线', label: '主线格' }, { value: '支线', label: '支线格' }, { value: '不在背包', label: '先不放' }]} />
        <small>{slot === '主线' ? '判断标准：对当前目标有没有用。主线是押注，到期那一周的回顾里决定继续还是换。'
          : slot === '支线' ? '不需要证明对主线有用，和主线一样是正式推进的事。' : '先建着，以后再放进背包；它的卡不会出现在首页。'}</small>
      </div>}
      {full && <div className="fm-f">
        <span>{slot}格满了，先冷藏或放弃一个</span>
        <div className="fm-pick">{candidates.map(p => (['冷藏', '放弃'] as const).map(action =>
          <button key={p.id + action} type="button" aria-pressed={room?.id === p.id && room.action === action} onClick={() => setRoom({ id: p.id, action })}>
            {action}「{p.name}」<i>{String(p.slotIndex).padStart(2, '0')}</i>
          </button>))}</div>
        <small>冷藏：移出背包，它的卡不再出现，随时可以放回。放弃：项目和它待做的卡都改为已放弃。</small>
      </div>}
    </div>
  </Dialog>;
}

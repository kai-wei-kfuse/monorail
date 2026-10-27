import { useState } from 'react';
import type { BackpackSlot, MakeRoom, ProjectDraft } from '../shared/backpack';
import { Dialog } from '../ui/overlay/Dialog';
import { Button } from '../ui/controls/Button';
import { Segmented } from '../ui/controls/Segmented';
import { TextInput } from '../ui/controls/TextInput';
import './forms.css';

export interface SlotProject { id: string; name: string; slot: BackpackSlot; slotIndex: number }
export type ProjectSlot = ProjectDraft['slot'];
export type { ProjectDraft };

/** 满格时先腾位置：列出这一格里的项目，每个都可以选「冷藏」或「放弃」。新建项目和放回背包共用。 */
function MakeRoomPicker({ slot, candidates, value, onChange }:
  { slot: BackpackSlot; candidates: SlotProject[]; value: MakeRoom | null; onChange: (room: MakeRoom) => void }) {
  return <div className="fm-f">
    <span>{slot}格满了，先冷藏或放弃一个</span>
    <div className="fm-pick">{candidates.map(p => (['冷藏', '放弃'] as const).map(action =>
      <button key={p.id + action} type="button" aria-pressed={value?.id === p.id && value.action === action} onClick={() => onChange({ id: p.id, action })}>
        {action}「{p.name}」<i>{String(p.slotIndex).padStart(2, '0')}</i>
      </button>))}</div>
    <small>冷藏：移出背包，它的卡不再出现，随时可以放回。放弃：项目和它待做的卡都改为已放弃。</small>
  </div>;
}

const SLOT_HINT: Record<BackpackSlot, string> = {
  主线: '判断标准：对当前目标有没有用。主线是押注，到期那一周的回顾里决定继续还是换。',
  支线: '不需要证明对主线有用，和主线一样是正式推进的事。',
};

/**
 * 新建项目 / 设定主线。背包满了还想开新坑，必须先把一个旧的冷藏或放弃（满格规则）。
 * mode 'setMain' 用于「设定主线」引导卡和回顾里的「换主线」：直接放进主线格。
 * 选冷藏还是放弃交给调用方执行；这里只收集选择。
 */
export function ProjectDialog({ mode, inBackpack, mainFree, sideFree, onSave, onCancel }:
  { mode: 'new' | 'setMain'; inBackpack: SlotProject[]; mainFree: boolean; sideFree: boolean;
    onSave: (draft: ProjectDraft, at: string) => void; onCancel: () => void }) {
  const [name, setName] = useState(''), [slot, setSlot] = useState<ProjectSlot>(mode === 'setMain' || mainFree ? '主线' : sideFree ? '支线' : '不在背包');
  const [room, setRoom] = useState<MakeRoom | null>(null);
  const full = slot === '主线' ? !mainFree : slot === '支线' ? !sideFree : false;
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
        <small>{slot === '不在背包' ? '先建着，以后再放进背包；它的卡不会出现在首页。' : SLOT_HINT[slot]}</small>
      </div>}
      {full && slot !== '不在背包' && <MakeRoomPicker slot={slot} candidates={inBackpack.filter(p => p.slot === slot)} value={room} onChange={setRoom} />}
    </div>
  </Dialog>;
}

/**
 * 放回背包：冷藏的、或者建了没放进背包的项目，由用户选放进主线格还是支线格。
 * 有空位时，满的那一格置灰；两格都满时都可以选，选中的那格要先冷藏或放弃一个腾位（和新建项目同一套交互）。
 */
export function RestoreDialog({ project, inBackpack, mainFree, sideFree, onRestore, onCancel }:
  { project: { id: string; name: string }; inBackpack: SlotProject[]; mainFree: boolean; sideFree: boolean;
    onRestore: (slot: BackpackSlot, at: string, makeRoom?: MakeRoom) => void; onCancel: () => void }) {
  const bothFull = !mainFree && !sideFree;
  const [slot, setSlot] = useState<BackpackSlot>(sideFree || bothFull ? '支线' : '主线');
  const [room, setRoom] = useState<MakeRoom | null>(null);
  const full = slot === '主线' ? !mainFree : !sideFree;
  const ok = !full || room !== null;
  const save = () => { if (ok) onRestore(slot, new Date().toISOString(), full && room ? room : undefined); };
  const option = (value: BackpackSlot, free: boolean) => ({ value, label: `${value}格`, disabled: !free && !bothFull, badge: !free && !bothFull ? '满了' : undefined });
  return <Dialog en="RESTORE" title={`放回背包：${project.name}`} onClose={onCancel}
    footer={<><Button onClick={onCancel}>取消</Button><Button tone="ink" disabled={!ok} onClick={save}>{full ? '腾出位置并放回' : '放回'}</Button></>}>
    <div className="fm">
      <div className="fm-f"><span>放进哪一格</span>
        <Segmented label="放进哪一格" value={slot} onChange={v => { setSlot(v); setRoom(null); }} options={[option('主线', mainFree), option('支线', sideFree)]} />
        <small>{SLOT_HINT[slot]}</small>
      </div>
      {full && <MakeRoomPicker slot={slot} candidates={inBackpack.filter(p => p.slot === slot)} value={room} onChange={setRoom} />}
    </div>
  </Dialog>;
}

import { useState } from 'react';
import type { BackpackSlot, MakeRoom, TaskDraft } from '../shared/backpack';
import { Dialog } from '../ui/overlay/Dialog';
import { Button } from '../ui/controls/Button';
import { Segmented } from '../ui/controls/Segmented';
import { TextInput } from '../ui/controls/TextInput';
import { ProjectPicker } from '../ui/controls/ProjectPicker';
import type { ProjectOption } from '../ui/controls/ProjectPicker';
import { ItemsEditor } from '../ui/controls/ItemsEditor';
import './forms.css';

export interface SlotTask { id: string; name: string; slot: BackpackSlot; slotIndex: number }
export type TaskSlot = TaskDraft['slot'];
export type { TaskDraft };

/** 满格时先腾位置：列出这一格里的任务，每个都可以选「冷藏」或「放弃」。新建任务和放回背包共用。 */
function MakeRoomPicker({ slot, candidates, value, onChange }:
  { slot: BackpackSlot; candidates: SlotTask[]; value: MakeRoom | null; onChange: (room: MakeRoom) => void }) {
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
 * 新建任务 / 设定主线任务。背包满了还想开新坑，必须先把一个旧的冷藏或放弃（满格规则）。
 * mode 'setMain' 用于「设定主线」引导卡和回顾里的「换主线」：直接放进主线格。
 * 选冷藏还是放弃交给调用方执行；这里只收集选择。
 * 下面要做的事（事项）不拆就是任务本身这一件事；主线每个任务最多 mainItems 项。计时项目是这个任务的事项开始计时时记到的项目。
 */
export function TaskDialog({ mode, initialSlot, inBackpack, mainFree, sideFree, mainItems, projects, onCreateProject, onSave, onCancel }:
  { mode: 'new' | 'setMain'; initialSlot?: BackpackSlot; inBackpack: SlotTask[]; mainFree: boolean; sideFree: boolean; mainItems: number;
    projects: ProjectOption[]; onCreateProject?: (name: string) => void; onSave: (draft: TaskDraft, at: string) => void; onCancel: () => void }) {
  const [name, setName] = useState(''), [slot, setSlot] = useState<TaskSlot>(mode === 'setMain' ? '主线' : initialSlot ?? (mainFree ? '主线' : sideFree ? '支线' : '不在背包'));
  const [items, setItems] = useState<string[]>(mode === 'setMain' || initialSlot === '主线' ? [''] : []), [project, setProject] = useState('未分类');
  const filled = items.map(s => s.trim()).filter(Boolean), maxItems = slot === '主线' ? mainItems : 99;
  const [room, setRoom] = useState<MakeRoom | null>(null);
  const full = slot === '主线' ? !mainFree : slot === '支线' ? !sideFree : false;
  const ok = name.trim().length > 0 && (!full || room !== null) && filled.length <= maxItems;
  const save = () => { if (ok) onSave({ name: name.trim(), slot, makeRoom: full ? room : null, items: filled, defaultProject: project === '未分类' ? null : project }, new Date().toISOString()); };
  return <Dialog en={mode === 'setMain' ? 'SET MAINLINE' : 'NEW TASK'} title={mode === 'setMain' ? '设定主线任务' : '新建任务'} onClose={onCancel}
    footer={<><Button onClick={onCancel}>取消</Button><Button tone="ink" disabled={!ok} onClick={save}>{full ? '腾出位置并放入' : '放入'}</Button></>}>
    <div className="fm">
      <div className="fm-f">
        <label htmlFor="proj-name">任务名</label>
        <TextInput id="proj-name" autoFocus value={name} placeholder="例如：我要找工作；或者：买一台服务器" onChange={e => setName(e.target.value)} />
      </div>
      {mode === 'new' && <div className="fm-f"><span>放在哪</span>
        <Segmented label="放在哪" value={slot} onChange={v => { setSlot(v); setRoom(null); }}
          options={[{ value: '主线', label: '主线格' }, { value: '支线', label: '支线格' }, { value: '不在背包', label: '先不放' }]} />
        <small>{slot === '不在背包' ? '先建着，以后再放进背包；它的卡不会出现在首页。' : SLOT_HINT[slot]}</small>
      </div>}
      <div className="fm-f"><span>下面要做的事</span>
        <ItemsEditor id="task-items" items={items} onChange={setItems} max={maxItems}
          hint={slot === '主线' ? `最多 ${mainItems} 项；不拆就是任务本身这一件事` : '不拆就是一件事（比如「买一台服务器」）'} />
      </div>
      <div className="fm-f"><span>计时项目</span><div className="fm-row">
        <ProjectPicker id="task-project" label="计时项目" value={project} options={projects} onChange={setProject} onCreate={onCreateProject} />
        <small>这个任务的事项开始计时，就记到这个项目上</small>
      </div></div>
      {full && slot !== '不在背包' && <MakeRoomPicker slot={slot} candidates={inBackpack.filter(p => p.slot === slot)} value={room} onChange={setRoom} />}
    </div>
  </Dialog>;
}

/**
 * 放回背包：冷藏的、或者建了没放进背包的项目，由用户选放进主线格还是支线格。
 * 有空位时，满的那一格置灰；两格都满时都可以选，选中的那格要先冷藏或放弃一个腾位（和新建任务同一套交互）。
 */
export function RestoreDialog({ task, inBackpack, mainFree, sideFree, onRestore, onCancel }:
  { task: { id: string; name: string }; inBackpack: SlotTask[]; mainFree: boolean; sideFree: boolean;
    onRestore: (slot: BackpackSlot, at: string, makeRoom?: MakeRoom) => void; onCancel: () => void }) {
  const bothFull = !mainFree && !sideFree;
  const [slot, setSlot] = useState<BackpackSlot>(sideFree || bothFull ? '支线' : '主线');
  const [room, setRoom] = useState<MakeRoom | null>(null);
  const full = slot === '主线' ? !mainFree : !sideFree;
  const ok = !full || room !== null;
  const save = () => { if (ok) onRestore(slot, new Date().toISOString(), full && room ? room : undefined); };
  const option = (value: BackpackSlot, free: boolean) => ({ value, label: `${value}格`, disabled: !free && !bothFull, badge: !free && !bothFull ? '满了' : undefined });
  return <Dialog en="RESTORE" title={`放回背包：${task.name}`} onClose={onCancel}
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

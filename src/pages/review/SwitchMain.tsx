import { useState } from 'react';
import type { MakeRoom, TaskDraft } from '../../shared/backpack';
import { Dialog } from '../../ui/overlay/Dialog';
import { Button } from '../../ui/controls/Button';
import { Segmented } from '../../ui/controls/Segmented';
import { TextInput } from '../../ui/controls/TextInput';
import '../../widgets/forms.css';

export type SwitchMainDraft = TaskDraft | { restoreId: string; makeRoom: MakeRoom };

/**
 * 主线复盘里的「换一条主线」：新主线可以新建，也可以从冷藏的项目里放回一个；
 * 正在复盘的旧主线必须明确冷藏或放弃（service 会核对），这一步随之做完。
 */
export function SwitchMain({ current, parked, onSave, onCancel }:
  { current: { id: string; name: string }; parked: { id: string; name: string }[];
    onSave: (draft: SwitchMainDraft, at: string) => void; onCancel: () => void }) {
  const [mode, setMode] = useState<'new' | 'restore'>('new');
  const [name, setName] = useState(''), [restoreId, setRestoreId] = useState<string | null>(null);
  const [action, setAction] = useState<MakeRoom['action']>('冷藏');
  const makeRoom: MakeRoom = { id: current.id, action };
  const ok = mode === 'new' ? name.trim().length > 0 : restoreId !== null;
  const save = () => {
    if (!ok) return;
    const at = new Date().toISOString();
    onSave(mode === 'new' ? { name: name.trim(), slot: '主线', makeRoom } : { restoreId: restoreId!, makeRoom }, at);
  };
  return <Dialog en="SWITCH MAINLINE" title="换一条主线" onClose={onCancel}
    footer={<><Button onClick={onCancel}>取消</Button><Button tone="ink" disabled={!ok} onClick={save}>换主线</Button></>}>
    <div className="fm">
      <div className="fm-f"><span>新主线</span>
        <Segmented label="新主线" value={mode} onChange={v => setMode(v)}
          options={[{ value: 'new', label: '新建项目' }, { value: 'restore', label: '放回冷藏的项目', disabled: !parked.length, badge: parked.length ? undefined : '没有' }]} />
      </div>
      {mode === 'new' ? <div className="fm-f">
        <label htmlFor="main-name">项目名</label>
        <TextInput id="main-name" autoFocus value={name} placeholder="一个正在推进的大方向，例如找工作" onChange={e => setName(e.target.value)} />
      </div> : <div className="fm-f"><span>选一个冷藏的项目</span>
        <div className="fm-pick">{parked.map(p =>
          <button key={p.id} type="button" aria-pressed={restoreId === p.id} onClick={() => setRestoreId(p.id)}>{p.name}</button>)}</div>
      </div>}
      <div className="fm-f"><span>旧主线「{current.name}」</span>
        <Segmented label="旧主线怎么处理" value={action} onChange={v => setAction(v)}
          options={[{ value: '冷藏', label: '冷藏' }, { value: '放弃', label: '放弃' }]} />
        <small>{action === '冷藏' ? '移出背包，它的卡不再出现，随时可以放回。' : '项目和它待做的卡都改为已放弃。'}</small>
      </div>
    </div>
  </Dialog>;
}

import { useState } from 'react';
import { Dialog } from '../ui/overlay/Dialog';
import { Button } from '../ui/controls/Button';
import { Segmented } from '../ui/controls/Segmented';
import { Slider } from '../ui/controls/Slider';
import { Switch } from '../ui/controls/Switch';
import { TextArea } from '../ui/controls/TextArea';
import { DateTimeInput } from '../ui/controls/DateTimeInput';
import { Dropdown } from '../ui/controls/Dropdown';
import './forms.css';

export interface CardFields {
  content: string; type: '结果卡' | '时间盒卡'; timeboxMinutes: number | null;
  blocking: boolean; dueAt: string | null; noShrink: boolean; projectId: string | null;
}
export const NEW_CARD: CardFields = { content: '', type: '结果卡', timeboxMinutes: null, blocking: false, dueAt: null, noShrink: false, projectId: null };

/**
 * 编辑或新建一张卡。卡必须能明确判断是否完成：要么是一个具体结果，要么是一段计满的时间。
 * PASS 只对能 PASS 的卡开放；已缩小的卡要先处理它缩小出来的卡（附录 A6），这时按钮置灰并说明原因。
 */
export function CardEditor({ initial, isNew, projects, defaultTimebox, passBlocked, onSave, onPass, onCancel }:
  { initial: CardFields; isNew: boolean; projects: { id: string; name: string }[]; defaultTimebox: number;
    passBlocked?: string; onSave: (fields: CardFields, at: string) => void; onPass?: (at: string) => void; onCancel: () => void }) {
  const [f, setF] = useState<CardFields>(initial);
  const set = (patch: Partial<CardFields>) => setF(prev => ({ ...prev, ...patch }));
  const ok = f.content.trim().length > 0;
  const save = () => { if (ok) onSave({ ...f, content: f.content.trim() }, new Date().toISOString()); };
  return <Dialog en={isNew ? 'NEW CARD' : 'EDIT CARD'} title={isNew ? '拆一张卡' : '编辑卡片'} onClose={onCancel}
    footer={<><Button onClick={onCancel}>取消</Button><Button tone="ink" disabled={!ok} onClick={save}>保存</Button></>}>
    <div className="fm">
      <div className="fm-f">
        <label htmlFor="card-content">内容</label>
        <TextArea id="card-content" autoGrow maxRows={4} autoFocus value={f.content} placeholder="例如：找 3 个 JD"
          onChange={e => set({ content: e.target.value })} />
        <small>用 [词] 标出重点词，首页标题里会高亮。例如：沿 [Python] 往下学 1 小时</small>
      </div>
      <div className="fm-f"><span>类型</span><div className="fm-row">
        <Segmented label="类型" value={f.type} onChange={type => set({ type, timeboxMinutes: type === '时间盒卡' ? f.timeboxMinutes ?? defaultTimebox : null })}
          options={[{ value: '结果卡', label: '结果卡' }, { value: '时间盒卡', label: '时间盒卡' }]} />
        {f.type === '时间盒卡' && <Slider label="目标时长" value={f.timeboxMinutes ?? defaultTimebox} min={5} max={240} step={5} unit="MIN" ticks={16}
          onChange={timeboxMinutes => set({ timeboxMinutes })} />}
      </div></div>
      <div className="fm-f"><span>所属项目</span>
        <Dropdown label="所属项目" value={f.projectId ?? ''} onChange={id => set({ projectId: id || null })}
          options={[{ value: '', label: '散件（按支线算）' }, ...projects.map(p => ({ value: p.id, label: p.name }))]} />
      </div>
      <div className="fm-f"><span>期限</span><div className="fm-row">
        <DateTimeInput label="期限" value={f.dueAt} onChange={dueAt => set({ dueAt })} />
      </div></div>
      <div className="fm-check"><div><b>阻塞</b><p>这件事挡住了别的事，选卡时排最前。</p></div><Switch label="阻塞" checked={f.blocking} onChange={blocking => set({ blocking })} /></div>
      <div className="fm-check"><div><b>不可缩小</b><p>本身很短的任务用，例如找 3 个 JD。</p></div><Switch label="不可缩小" checked={f.noShrink} onChange={noShrink => set({ noShrink })} /></div>
      {!isNew && onPass && <div className="fm-danger">
        <Button tone="danger" disabled={!!passBlocked} onClick={() => onPass(new Date().toISOString())}>PASS</Button>
        <span>{passBlocked ?? '放弃这张卡。它不会再出现在首页。'}</span>
      </div>}
    </div>
  </Dialog>;
}

import { useState } from 'react';
import type { IdeaTaskInput } from '../services/ideaService';
import { Dialog } from '../ui/overlay/Dialog';
import { Button } from '../ui/controls/Button';
import { Segmented } from '../ui/controls/Segmented';
import { TextInput } from '../ui/controls/TextInput';
import { Dropdown } from '../ui/controls/Dropdown';
import { ProjectPicker } from '../ui/controls/ProjectPicker';
import type { ProjectOption } from '../ui/controls/ProjectPicker';
import { ItemsEditor } from '../ui/controls/ItemsEditor';
import './forms.css';

/**
 * 想法转任务（原型 backpack.js 的 ConvertDialog，方案 §7.5）：转成支线任务，或者主线任务（放进一个还有空位的主线任务，或者新建一个）。
 * 放进已有任务时要拆成至少一项；新建任务不拆就是任务本身这一件事。每个想法只能转一次，转过以后按钮变灰（由列表负责）。
 */
export function ConvertIdea({ ideaText, mains, mainFree, sideFree, mainItems, projects, onCreateProject, onConvert, onCancel }:
  { ideaText: string; mains: { id: string; name: string; room: number }[]; mainFree: boolean; sideFree: boolean; mainItems: number;
    projects: ProjectOption[]; onCreateProject?: (name: string) => void; onConvert: (input: IdeaTaskInput, at: string) => void; onCancel: () => void }) {
  const roomy = mains.filter(m => m.room > 0), first = ideaText.split('\n')[0];
  const [slot, setSlot] = useState<'主线' | '支线'>(sideFree ? '支线' : '主线');
  const [target, setTarget] = useState(roomy[0]?.id ?? ''), [name, setName] = useState(first), [project, setProject] = useState('未分类');
  const into = slot === '主线' ? roomy.find(m => m.id === target) ?? null : null;
  const [items, setItems] = useState<string[]>(into ? [first] : []);
  const filled = items.map(s => s.trim()).filter(Boolean), max = into ? into.room : slot === '主线' ? mainItems : 99;
  const ok = into ? filled.length >= 1 && filled.length <= into.room
    : (slot === '支线' ? sideFree : mainFree) && !!name.trim() && filled.length <= max;
  const pick = (s: '主线' | '支线') => { setSlot(s); if (s === '主线' && target && !items.length) setItems([first]); };
  const go = () => onConvert(into ? { taskId: into.id, items: filled }
    : { name: name.trim(), slot, defaultProject: project === '未分类' ? null : project, items: filled.length ? filled : [name.trim()] }, new Date().toISOString());
  return <Dialog en="TO QUEST" title="转成任务" onClose={onCancel}
    footer={<><Button onClick={onCancel}>取消</Button><Button tone="ink" disabled={!ok} onClick={go}>转成任务</Button></>}>
    <div className="fm">
      <div className="fm-f"><span>转成</span>
        <Segmented label="转成" value={slot} onChange={pick} options={[
          { value: '支线', label: '支线任务', disabled: !sideFree, badge: sideFree ? undefined : '满' },
          { value: '主线', label: '主线任务', disabled: !roomy.length && !mainFree }]} />
      </div>
      {slot === '主线' && <div className="fm-f"><span>放到</span>
        <Dropdown label="放到" value={target} onChange={v => { setTarget(v); if (v && !items.length) setItems([first]); }}
          options={[...roomy.map(m => ({ value: m.id, label: `放进「${m.name}」（还能放 ${m.room} 项）` })), ...(mainFree ? [{ value: '', label: '新建一个主线任务' }] : [])]} />
      </div>}
      {!into && <div className="fm-f">
        <label htmlFor="idea-task">{slot}任务名</label>
        <TextInput id="idea-task" autoFocus value={name} onChange={e => setName(e.target.value)} />
      </div>}
      <div className="fm-f"><span>拆成</span>
        <ItemsEditor id="idea-items" items={items} onChange={setItems} max={max}
          hint={into ? '一项或多项，每项都是一件能判断做没做完的事' : slot === '支线' ? '不拆就是一件事；也可以拆成一串' : `不拆就是任务本身这一件事；最多 ${mainItems} 项`} />
      </div>
      {!into && <div className="fm-f"><span>计时项目</span><div className="fm-row">
        <ProjectPicker id="idea-project" label="计时项目" value={project} options={projects} onChange={setProject} onCreate={onCreateProject} />
        <small>这个任务的事项开始计时，就记到这个项目上</small>
      </div></div>}
    </div>
  </Dialog>;
}

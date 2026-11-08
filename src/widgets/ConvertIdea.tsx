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
 * 想法转任务（0.3.3 多主线支持，ADR 0026 §4 & ADR 0027 §2）：
 * - 仅带入想法单行标题（不拼接 Markdown 详情）。
 * - 转成主线任务时，支持明确选择并入哪一条已有主线（按 task.id）或新建主线任务；所选主线容量不足时明确提示并拦截，绝不静默转移到其他主线。
 */
export function ConvertIdea({
  ideaText,
  mains,
  mainFree,
  sideFree,
  mainItems,
  projects,
  onCreateProject,
  onConvert,
  onCancel,
}: {
  ideaText: string;
  mains: { id: string; name: string; room: number }[];
  mainFree: boolean;
  sideFree: boolean;
  mainItems: number;
  projects: ProjectOption[];
  onCreateProject?: (name: string) => void;
  onConvert: (input: IdeaTaskInput, at: string) => void;
  onCancel: () => void;
}) {
  const roomy = mains.filter(m => m.room > 0);
  const first = ideaText.split('\n')[0] ?? '';
  const [slot, setSlot] = useState<'主线' | '支线'>(sideFree ? '支线' : '主线');
  const [target, setTarget] = useState<string>(roomy[0]?.id ?? '');
  const [name, setName] = useState(first);
  const [project, setProject] = useState('未分类');

  const isExistingMain = slot === '主线' && target !== '';
  const selectedMain = isExistingMain ? mains.find(m => m.id === target) ?? null : null;
  const [items, setItems] = useState<string[]>(isExistingMain ? [first] : []);

  const filled = items.map(s => s.trim()).filter(Boolean);
  const max = isExistingMain ? Math.max(0, selectedMain?.room ?? 0) : slot === '主线' ? mainItems : 99;
  const roomError =
    isExistingMain && (!selectedMain || selectedMain.room <= 0)
      ? `所选主线任务${selectedMain ? `「${selectedMain.name}」` : ''}子任务已满，请换一条主线或新建主线任务`
      : isExistingMain && selectedMain && filled.length > selectedMain.room
      ? `所选主线任务「${selectedMain.name}」最多还能放 ${selectedMain.room} 项`
      : null;

  const ok = isExistingMain
    ? Boolean(selectedMain && selectedMain.room > 0 && filled.length >= 1 && filled.length <= selectedMain.room)
    : (slot === '支线' ? sideFree : mainFree) && Boolean(name.trim()) && filled.length <= max;

  const pick = (s: '主线' | '支线') => {
    setSlot(s);
    if (s === '主线' && target && !items.length) setItems([first]);
  };

  const go = () => {
    if (!ok) return;
    if (isExistingMain && selectedMain) {
      onConvert({ taskId: selectedMain.id, items: filled }, new Date().toISOString());
      return;
    }
    onConvert(
      {
        name: name.trim(),
        slot,
        defaultProject: project === '未分类' ? null : project,
        items: filled.length ? filled : [name.trim()],
      },
      new Date().toISOString(),
    );
  };

  const pad2 = (n: number) => String(n).padStart(2, '0');

  return (
    <Dialog
      en="TO QUEST"
      title="转成任务"
      onClose={onCancel}
      footer={
        <>
          <Button onClick={onCancel}>取消</Button>
          <Button tone="ink" disabled={!ok} onClick={go}>
            转成任务
          </Button>
        </>
      }
    >
      <div className="fm">
        <div className="fm-f">
          <span>转成</span>
          <Segmented
            label="转成"
            value={slot}
            onChange={pick}
            options={[
              { value: '支线', label: '支线任务', disabled: !sideFree, badge: sideFree ? undefined : '满' },
              { value: '主线', label: '主线任务', disabled: !roomy.length && !mainFree },
            ]}
          />
        </div>
        {slot === '主线' && (
          <div className="fm-f">
            <span>放到</span>
            <Dropdown
              label="放到"
              value={target}
              onChange={v => {
                setTarget(v);
                if (v && !items.length) setItems([first]);
              }}
              options={[
                ...mains.map((m, idx) => ({
                  value: m.id,
                  label:
                    m.room > 0
                      ? `主线 ${pad2(idx + 1)} · 放进「${m.name}」（还能放 ${m.room} 项）`
                      : `主线 ${pad2(idx + 1)} · 「${m.name}」（已满）`,
                })),
                ...(mainFree ? [{ value: '', label: '新建一个主线任务' }] : []),
              ]}
            />
          </div>
        )}
        {roomError && (
          <p className="ls-warn" role="alert" style={{ margin: 0 }}>
            {roomError}
          </p>
        )}
        {!isExistingMain && (
          <div className="fm-f">
            <label htmlFor="idea-task">{slot}任务名</label>
            <TextInput id="idea-task" autoFocus value={name} onChange={e => setName(e.target.value)} />
          </div>
        )}
        <div className="fm-f">
          <span>拆成</span>
          <ItemsEditor
            id="idea-items"
            items={items}
            onChange={setItems}
            max={Math.max(1, max)}
            hint={
              isExistingMain
                ? '一项或多项，每项都是一件能判断做没做完的事'
                : slot === '支线'
                ? '不拆就是一件事；也可以拆成一串'
                : `不拆就是任务本身这一件事；最多 ${mainItems} 项`
            }
          />
        </div>
        {!isExistingMain && (
          <div className="fm-f">
            <span>计时项目</span>
            <div className="fm-row">
              <ProjectPicker
                id="idea-project"
                label="计时项目"
                value={project}
                options={projects}
                onChange={setProject}
                onCreate={onCreateProject}
              />
              <small>这个任务的事项开始计时，就记到这个项目上</small>
            </div>
          </div>
        )}
      </div>
    </Dialog>
  );
}

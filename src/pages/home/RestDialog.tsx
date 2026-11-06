import { useState } from 'react';
import { Dialog } from '../../ui/overlay/Dialog';
import { Button } from '../../ui/controls/Button';
import { ProjectPicker } from '../../ui/controls/ProjectPicker';
import type { ProjectOption } from '../../ui/controls/ProjectPicker';
import './home.css';

/**
 * 〔休息一下〕先选项目（已定 55、63）：默认系统项目「休息」，可以换成别的项目，确定后插入一条「休息」，原来那张卡等你回来。
 * 点下〔休息一下〕的那一刻就是开始时刻（at 由外面在点按钮时取，这里原样交回）。
 */
export function RestDialog({ projects, onConfirm, onCancel }:
  { projects: ProjectOption[]; onConfirm: (project: string) => void; onCancel: () => void }) {
  const [project, setProject] = useState('休息');
  const options = [{ name: '休息', color: 'var(--mute-2)' }, ...projects.filter(p => p.name !== '休息')];
  return <Dialog en="REST · 休息一下" title="休息一下" onClose={onCancel}
    footer={<><Button onClick={onCancel}>不休息了</Button><Button tone="ink" onClick={() => onConfirm(project)}>开始休息</Button></>}>
    这张卡先停着等你回来，回来就接着计。
    <div className="dlg-field">
      <label htmlFor="rest-project">记到</label>
      <ProjectPicker id="rest-project" value={project} options={options} onChange={setProject} />
    </div>
  </Dialog>;
}

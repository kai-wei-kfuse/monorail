import { useState } from 'react';
import { Dialog } from '../ui/overlay/Dialog';
import { Button } from '../ui/controls/Button';
import { TextArea } from '../ui/controls/TextArea';
import { Dropdown } from '../ui/controls/Dropdown';
import './forms.css';

/**
 * 想法转待办：生成一张卡。每个想法只能转一次，转过以后按钮变灰（由列表负责）。
 * 卡的内容默认取想法原文，可以改成一件能明确判断完成的事。
 */
export function ConvertIdea({ ideaText, projects, onConvert, onCancel }:
  { ideaText: string; projects: { id: string; name: string }[]; onConvert: (r: { content: string; projectId: string | null; at: string }) => void; onCancel: () => void }) {
  const [content, setContent] = useState(ideaText.split('\n')[0]), [projectId, setProjectId] = useState('');
  const ok = content.trim().length > 0;
  return <Dialog en="TO CARD" title="转为待办" onClose={onCancel}
    footer={<><Button onClick={onCancel}>取消</Button>
      <Button tone="ink" disabled={!ok} onClick={() => onConvert({ content: content.trim(), projectId: projectId || null, at: new Date().toISOString() })}>转为待办</Button></>}>
    <div className="fm">
      <div className="fm-f">
        <label htmlFor="idea-card">卡的内容</label>
        <TextArea id="idea-card" autoGrow maxRows={4} autoFocus value={content} onChange={e => setContent(e.target.value)} />
        <small>想法本身可能很大。写成一件能判断完成的事，或者一段计满的时间。</small>
      </div>
      <div className="fm-f"><span>所属项目</span>
        <Dropdown label="所属项目" value={projectId} onChange={setProjectId}
          options={[{ value: '', label: '散件（按支线算）' }, ...projects.map(p => ({ value: p.id, label: p.name }))]} />
      </div>
    </div>
  </Dialog>;
}

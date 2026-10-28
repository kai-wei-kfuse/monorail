import type { KeyboardEvent } from 'react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '../../ui/controls/Button';
import { ProjectPicker } from '../../ui/controls/ProjectPicker';
import type { ProjectOption } from '../../ui/controls/ProjectPicker';
import { TagPicker } from '../../ui/controls/TagPicker';
import { TextInput } from '../../ui/controls/TextInput';
import './shell.css';

export interface MiniEditValue { name: string; project: string; tags: string[] }

/**
 * 小窗里改当前这一条（原型 shell.js 的 MiniEdit，UI 规范 §11.9）：名称、项目、标签。
 * editing：正在计的这一条（自由记录或卡）；否则是写下现在在做什么。点面板外面、回车、「确定」都算确定；Esc、「取消」不改。
 */
export function MiniEdit({ editing, isCard, pendingSince, initial, projects, knownTags, onCreateProject, onCreateTag, onSave, onCancel }:
  { editing: boolean; isCard: boolean; pendingSince: string | null; initial: MiniEditValue; projects: ProjectOption[]; knownTags: string[];
    onCreateProject?: (name: string) => void; onCreateTag?: (tag: string) => void; onSave: (value: MiniEditValue) => void; onCancel: () => void }) {
  const [v, setV] = useState(initial);
  const box = useRef<HTMLDivElement>(null), latest = useRef(() => onSave(v));
  latest.current = () => onSave(v);
  useEffect(() => {
    box.current?.querySelector<HTMLInputElement>('#mini-name')?.focus();
    const away = (e: PointerEvent) => { const t = e.target as Element; if (!box.current?.contains(t) && !t.closest?.('.mini-title, .sel-pop')) latest.current(); };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, []);
  const keys = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'Enter') { e.preventDefault(); onSave(v); }
    if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
  };
  const pad = (n: number) => String(n).padStart(2, '0'), d = pendingSince ? new Date(pendingSince) : null;
  return <div className="mini-edit" ref={box} role="dialog" aria-label="修改当前这一条">
    <div className="mini-edit-head"><span className="k">{editing ? 'EDIT' : 'NOW'}<em>{editing ? '修改正在计的这一条' : '现在在做什么'}</em></span>
      {d && <span className="mini-edit-t">从 {pad(d.getHours())}:{pad(d.getMinutes())}:{pad(d.getSeconds())} 起已在计时，还没写盘</span>}</div>
    <TextInput id="mini-name" className="mini-edit-name" aria-label="名称" value={v.name} placeholder="I am working on…" onChange={e => setV({ ...v, name: e.target.value })} onKeyDown={keys} />
    <div className="mini-edit-row">
      <ProjectPicker id="mini-project" value={v.project} options={projects} onChange={project => setV({ ...v, project })} onCreate={onCreateProject} onKeyDown={keys} />
      <TagPicker id="mini-tags" value={v.tags} options={knownTags} onChange={tags => setV({ ...v, tags })} onCreate={onCreateTag} onKeyDown={keys} />
    </div>
    {isCard && <p className="mini-edit-t">这条来自卡：改名称就是改卡的内容，项目和标签也存在卡上。</p>}
    <div className="mini-edit-foot"><Button onClick={onCancel}>取消</Button><Button tone="ink" onClick={() => onSave(v)}>确定</Button></div>
  </div>;
}

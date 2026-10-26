import { useState } from 'react';
import { Tri2 } from '../../ui/icons/Icon';
import { TextArea } from '../../ui/controls/TextArea';
import { Keycap } from '../../ui/controls/Keycap';
import { Chip } from '../../ui/controls/Chip';
import type { DraftFields } from './QuickBarFields';
import { EMPTY_FIELDS, QuickBarFields } from './QuickBarFields';
import type { PendingAttachment } from './useAttachments';
import { useAttachments } from './useAttachments';
import './quickbar.css';

export interface Draft extends DraftFields { text: string; attachments: PendingAttachment[]; at: string }

/**
 * 快速记录条：写一行，Enter 保存；Shift+Enter 换行，记录条随之变高；Esc 隐藏。
 * 保存成功后清空，由调用方隐藏窗口并发 data-changed。保存失败时内容保留，显示原因。
 */
export function QuickBar({ projects, onSave, onHide }:
  { projects: { id: string; name: string }[]; onSave: (draft: Draft) => Promise<void>; onHide: () => void }) {
  const [text, setText] = useState(''), [fields, setFields] = useState<DraftFields>(EMPTY_FIELDS);
  const [saving, setSaving] = useState(false), [error, setError] = useState('');
  const att = useAttachments();
  async function save() {
    if (saving || (!text.trim() && !att.items.length)) return;
    setSaving(true); setError('');
    try {
      await onSave({ ...fields, text: text.trim(), attachments: att.items, at: new Date().toISOString() });
      setText(''); setFields(EMPTY_FIELDS); att.clear();
    } catch (e) { setError(`没存上：${e instanceof Error ? e.message : String(e)}`); }
    finally { setSaving(false); }
  }
  return <div className={`qb${att.over ? ' drop' : ''}`} onDragOver={att.onDragOver} onDragLeave={att.onDragLeave} onDrop={att.onDrop}>
    <div className="qb-line">
      <span className="qb-tab"><Tri2 /></span>
      <TextArea autoGrow maxRows={10} autoFocus className="qb-input" aria-label="记录" placeholder="写一行。#标签 会自动提取"
        value={text} onChange={e => setText(e.target.value)} onPaste={att.onPaste}
        onKeyDown={e => {
          if (e.key === 'Escape') { e.preventDefault(); onHide(); }
          else if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void save(); }
        }} />
      <span className="qb-save">{saving ? '保存中…' : <><Keycap keys="Enter" small />保存</>}</span>
    </div>
    <QuickBarFields value={fields} onChange={setFields} projects={projects} />
    {att.items.length > 0 && <div className="qb-files">{att.items.map(a => <Chip key={a.id} label={a.name} onRemove={() => att.remove(a.id)} />)}</div>}
    {error && <p className="qb-msg" role="alert">{error}</p>}
  </div>;
}

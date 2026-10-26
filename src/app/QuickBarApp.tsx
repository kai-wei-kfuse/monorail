import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { emit } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { encode } from '../data/frontmatter';
import { recordSchema } from '../data/schemas';
import type { RecordEntry } from '../domain/record/record';

async function persistRecord(input: RecordEntry) {
  const value = recordSchema.parse(input);
  await invoke('save_quick_record', { id: value.id, text: encode(value, value.text) });
  await invoke('evidence', { message: `quickbar-saved:${value.id}` });
  await emit('data-changed', { recordId: value.id });
}

export function QuickBarApp() {
  const [text, setText] = useState('验证待办');
  const [due, setDue] = useState('');
  const [status, setStatus] = useState('');
  useEffect(() => {
    if (import.meta.env.VITE_VERIFY === 'true') {
      void import('../verification/quickbar').then(module => module.install(persistRecord)).catch(error => setStatus(String(error)));
    }
  }, []);
  async function save() {
    try {
      const value = recordSchema.parse({ id: crypto.randomUUID(), text, kind: '待办', created_at: new Date().toISOString(),
        due_at: due ? new Date(due).toISOString() : null, blocking: true, project_id: null, card_id: null, tags: [], attachments: [] });
      await persistRecord(value);
      setStatus(`已保存 ${value.id}`);
    } catch (error) { setStatus(`保存失败：${String(error)}`); }
  }
  return <main style={{ padding: 12 }}>
    <h2>快速记录 · 技术验证</h2>
    <label>待办 <input aria-label="待办内容" value={text} onChange={e => setText(e.target.value)} /></label><br />
    <label>期限 <input aria-label="期限" type="datetime-local" value={due} onChange={e => setDue(e.target.value)} /></label>
    <button onClick={() => setDue(new Date(Date.now() + 61 * 60_000).toLocaleString('sv-SE').slice(0, 16).replace(' ', 'T'))}>期限设为61分钟后</button><br />
    <button onClick={() => void save()}>保存待办</button>
    <button onClick={() => void emit('data-changed')}>重复发送 data-changed</button>
    <button onClick={() => void getCurrentWindow().hide()}>隐藏</button>
    <p role="status">{status}</p>
  </main>;
}

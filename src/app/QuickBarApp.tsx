import { useEffect, useLayoutEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { emit } from '@tauri-apps/api/event';
import { getCurrentWindow, LogicalSize } from '@tauri-apps/api/window';
import { encode } from '../data/frontmatter';
import { recordSchema } from '../data/schemas';
import type { RecordEntry } from '../domain/record/record';
import { QuickBar } from '../pages/quickbar/QuickBar';
import type { Draft } from '../pages/quickbar/QuickBar';
import '../ui/styles/base.css';

/** 记录条只能经窄命令 save_quick_record 新建 records/<uuid>.md（架构 §3.2），写完发 data-changed，主窗口负责 reconcile。 */
async function persistRecord(input: RecordEntry) {
  const value = recordSchema.parse(input);
  await invoke('save_quick_record', { id: value.id, text: encode(value, value.text) });
  await invoke('evidence', { message: `quickbar-saved:${value.id}` });
  await emit('data-changed', { recordId: value.id });
}

/** 记录条的草稿 → 记录。阻塞、期限只对待办有意义；想法的「需要的资源」作为 needs 字段保存。 */
function toRecord(d: Draft): RecordEntry & { needs?: string } {
  if (d.attachments.length) throw new Error('附件下一步才支持，先把附件去掉再保存');
  const todo = d.kind === '待办';
  // TODO(domain): #标签 的提取应由 domain/record 提供（架构 §3.1），落地后改为调用它。
  return { id: crypto.randomUUID(), text: d.text, kind: d.kind, created_at: d.at, due_at: todo ? d.dueAt : null, blocking: todo && d.blocking,
    project_id: d.projectId, card_id: null, tags: [], attachments: [], ...(d.kind === '想法' && d.needs.trim() ? { needs: d.needs.trim() } : {}) };
}

export function QuickBarApp() {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (import.meta.env.VITE_VERIFY === 'true') void import('../verification/quickbar').then(module => module.install(persistRecord));
  }, []);
  // 记录条随内容变高：量出内容高度，交给窗口
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => { void getCurrentWindow().setSize(new LogicalSize(760, Math.ceil(el.getBoundingClientRect().height))).catch(() => {}); });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const hide = () => void getCurrentWindow().hide();
  // 项目列表要读 projects/，记录条现在只有窄写命令、没有读权限，先不提供；M2 接线时补
  return <div ref={box}><QuickBar projects={[]} onHide={hide} onSave={async draft => { await persistRecord(toRecord(draft)); hide(); }} /></div>;
}

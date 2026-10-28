import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { emit, listen } from '@tauri-apps/api/event';
import { getCurrentWindow, LogicalSize } from '@tauri-apps/api/window';
import { encode } from '../data/frontmatter';
import { recordSchema } from '../data/schemas';
import { toV1, taskReferenceFields } from '../data/v1Codec';
import { createRecord } from '../domain/record/record';
import type { RecordEntry } from '../domain/record/record';
import { QuickBar } from '../pages/quickbar/QuickBar';
import type { Draft } from '../pages/quickbar/QuickBar';
import { saveAttachment } from '../platform/attachments';
import { withQuickSave } from '../platform/quickSave';
import { subscribeQuickbarContext } from '../platform/quickbarContext';
import type { QuickbarContext } from '../platform/quickbarContext';
import '../ui/styles/base.css';

/** 记录条只能经窄命令 save_quick_record 新建 records/<uuid>.md（架构 §3.2），写完发 data-changed，主窗口负责 reconcile。 */
async function persistRecord(input: RecordEntry) {
  const value = recordSchema.parse(input);
  await invoke('save_quick_record', { id: value.id, text: encode(toV1(value, taskReferenceFields), value.text) });
  await invoke('evidence', { message: `quickbar-saved:${value.id}` });
  await emit('data-changed', { recordId: value.id });
}

/** Attachments first, then the record (#51): a crash in between leaves orphan files, never a record pointing at nothing. */
async function save(draft: Draft) {
  const id = crypto.randomUUID();
  await withQuickSave(id, async () => {
    const paths: string[] = [];
    for (const item of draft.attachments) {
      if (!item.blob) throw new Error(`读不到附件内容：${item.name}`);
      paths.push(await saveAttachment(id, item.name, item.blob));
    }
    await persistRecord(toRecord(draft, id, paths));
  });
}

/** 记录条的草稿 → 记录。阻塞、期限只对待办有意义；tags 和想法的生命周期字段由 createRecord 统一生成。 */
function toRecord(d: Draft, id: string, attachments: string[]): RecordEntry {
  const todo = d.kind === '待办';
  return createRecord({ id, text: d.text, kind: d.kind, created_at: d.at, due_at: todo ? d.dueAt : null, blocking: todo && d.blocking,
    task_id: d.taskId, card_id: null, tags: [], attachments, needs: d.kind === '想法' ? d.needs : null });
}

export function QuickBarApp() {
  const box = useRef<HTMLDivElement>(null);
  const dirty = useRef(false);
  const [guardError, setGuardError] = useState('');
  const onDirtyChange = useCallback((value: boolean) => { dirty.current = value; }, []);
  useEffect(() => {
    const off = listen('update-check-draft', () => {
      void invoke('ack_quickbar_update', { dirty: dirty.current }).catch(error => setGuardError(String(error)));
    });
    void off.then(() => invoke('quickbar_update_ready')).catch(error => setGuardError(String(error)));
    return () => { void off.then(fn => fn()); };
  }, []);
  useEffect(() => {
    if (import.meta.env.VITE_VERIFY === 'true') void import('../verification/quickbar').then(module =>
      module.install(record => withQuickSave(record.id, () => persistRecord(record))));
  }, []);
  // 记录条随内容变高：量出内容高度，交给窗口
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => { void getCurrentWindow().setSize(new LogicalSize(760, Math.ceil(el.getBoundingClientRect().height))).catch(() => {}); });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // Tasks and accent come from the main window; the quick bar has no read access to the data folder.
  const [context, setContext] = useState<QuickbarContext>({ tasks: [], accent: '' });
  useEffect(() => {
    const off = subscribeQuickbarContext(setContext);
    return () => { void off.then(fn => fn()); };
  }, []);
  useEffect(() => { if (context.accent) document.documentElement.style.setProperty('--yellow', context.accent); }, [context.accent]);
  const hide = () => void getCurrentWindow().hide();
  return <div ref={box}><QuickBar tasks={context.tasks} onHide={hide} onDirtyChange={onDirtyChange}
    onSave={async draft => { await save(draft); hide(); }} />
    {guardError && <p role="alert">更新草稿检查失败：{guardError}</p>}</div>;
}

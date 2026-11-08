import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { emit, listen } from '@tauri-apps/api/event';
import { getCurrentWindow, LogicalSize } from '@tauri-apps/api/window';
import { encode } from '../data/frontmatter';
import { recordSchema } from '../data/schemas';
import { createRecord, createRecordWithDetails } from '../domain/record/record';
import type { RecordEntry } from '../domain/record/record';
import { QuickBar } from '../pages/quickbar/QuickBar';
import type { Draft } from '../pages/quickbar/QuickBar';
import type { PendingAttachment } from '../pages/quickbar/useAttachments';
import { saveAttachment } from '../platform/attachments';
import {
  createDraftCheckTracker,
  getCurrentWindowLabel,
  nativeIdeaWindows,
} from '../platform/ideaWindows';
import { withQuickSave } from '../platform/quickSave';
import { subscribeQuickbarContext } from '../platform/quickbarContext';
import type { QuickbarContext } from '../platform/quickbarContext';
import type {
  IdeaDraftHandoffSnapshot,
  IdeaWindowCommittedEvent,
  IdeaWindowReply,
} from '../shared/ideaWindow';
import '../ui/styles/base.css';

/** 记录条只能经窄命令 save_quick_record 新建 records/<uuid>.md（架构 §3.2），写完发 data-changed，主窗口负责 reconcile。 */
async function persistRecord(input: RecordEntry, details = '') {
  const value = recordSchema.parse(input);
  await invoke('save_quick_record', { id: value.id, text: encode(value, details) });
  await invoke('evidence', { message: `quickbar-saved:${value.id}` });
  await emit('data-changed', { recordId: value.id });
}

/** 记录条的草稿 → 记录（schema v3：标题存 frontmatter text，Markdown 详情存文件正文）。 */
function toRecord(d: Draft, id: string, attachments: string[]): { entry: RecordEntry; details: string } {
  const todo = d.kind === '待办';
  if (todo) {
    return {
      entry: createRecord({
        id,
        text: d.text,
        kind: '待办',
        created_at: d.at,
        due_at: d.dueAt,
        blocking: false,
        task_id: d.taskId,
        card_id: null,
        tags: [],
        attachments,
        needs: null,
        created_via: 'quickbar',
      }),
      details: '',
    };
  }
  const { record, details } = createRecordWithDetails({
    id,
    text: d.text,
    details: d.detailsMarkdown ?? '',
    kind: '想法',
    created_at: d.at,
    due_at: null,
    blocking: false,
    task_id: d.taskId,
    card_id: null,
    tags: [],
    attachments,
    needs: d.needs,
    created_via: 'quickbar',
  });
  return { entry: record, details };
}

/** Attachments first, then the record (#51): a crash in between leaves orphan files, never a record pointing at nothing. */
async function saveLocal(draft: Draft) {
  const id = crypto.randomUUID();
  await withQuickSave(id, async () => {
    const paths: string[] = [];
    for (const item of draft.attachments) {
      if (!item.blob) throw new Error(`读不到附件内容：${item.name}`);
      paths.push(await saveAttachment(id, item.name, item.blob));
    }
    const { entry, details } = toRecord(draft, id, paths);
    await persistRecord(entry, details);
  });
}

export function QuickBarApp() {
  const box = useRef<HTMLDivElement>(null);
  const dirty = useRef(false);
  const [guardError, setGuardError] = useState('');
  const [maintenanceLocked, setMaintenanceLocked] = useState(false);
  const [externalCommitted, setExternalCommitted] = useState<IdeaWindowCommittedEvent | null>(null);
  const mainEpochRef = useRef<number>(1);
  const handoffSessionRef = useRef<string>('quickbar');

  const onDirtyChange = useCallback((value: boolean) => {
    dirty.current = value;
  }, []);

  useEffect(() => {
    const tracker = createDraftCheckTracker();
    const offCheck = listen('update-check-draft', event => {
      const myLabel = getCurrentWindowLabel() ?? 'quickbar';
      const reqId = tracker.acceptCheck(event.payload, myLabel);
      if (!reqId) return;
      setMaintenanceLocked(true);
      const isDirty = dirty.current;
      void nativeIdeaWindows
        .ackDraftCheck('quickbar', isDirty, reqId, {
          reason: isDirty ? '快速记录条还有未保存内容，请保存或清空后重试安装更新' : undefined,
        })
        .catch(error => setGuardError(String(error)));
    });
    const offRestore = listen('draft-check-restore', event => {
      const myLabel = getCurrentWindowLabel() ?? 'quickbar';
      if (!tracker.acceptRestore(event.payload, myLabel)) return;
      setMaintenanceLocked(false);
    });
    const offCommitted = nativeIdeaWindows.subscribeCommitted(event => {
      mainEpochRef.current = event.mainEpoch;
      setExternalCommitted(event);
    });
    void Promise.all([offCheck, offRestore, offCommitted])
      .then(() => invoke('quickbar_update_ready'))
      .catch(error => setGuardError(String(error)));
    return () => {
      void offCheck.then(fn => fn());
      void offRestore.then(fn => fn());
      void offCommitted.then(fn => fn());
    };
  }, []);

  useEffect(() => {
    if (import.meta.env.VITE_VERIFY === 'true') {
      void import('../verification/quickbar').then(module =>
        module.install(record => withQuickSave(record.id, () => persistRecord(record, ''))),
      );
    }
  }, []);

  // 记录条随内容变高：量出内容高度，交给窗口
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      void getCurrentWindow()
        .setSize(new LogicalSize(760, Math.ceil(el.getBoundingClientRect().height)))
        .catch(() => {});
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Tasks and accent come from the main window; the quick bar has no read access to the data folder.
  const [context, setContext] = useState<QuickbarContext>({ tasks: [], accent: '' });
  useEffect(() => {
    const off = subscribeQuickbarContext(setContext);
    return () => {
      void off.then(fn => fn());
    };
  }, []);
  useEffect(() => {
    if (context.accent) document.documentElement.style.setProperty('--yellow', context.accent);
  }, [context.accent]);

  const hide = () => void getCurrentWindow().hide();

  const handleOpenIdeaWindow = async (
    snapshot: IdeaDraftHandoffSnapshot,
    pendingAttachments: PendingAttachment[] = [],
  ): Promise<string[]> => {
    const newPaths: string[] = [];
    if (pendingAttachments.length > 0) {
      await withQuickSave(snapshot.draftId, async () => {
        for (const item of pendingAttachments) {
          if (!item.blob) throw new Error(`读不到附件内容：${item.name}`);
          newPaths.push(await saveAttachment(snapshot.draftId, item.name, item.blob));
        }
      });
    }
    const mergedAttachments = Array.from(new Set([...snapshot.attachments, ...newPaths]));
    const nextSnapshot: IdeaDraftHandoffSnapshot = {
      ...snapshot,
      attachments: mergedAttachments,
    };
    const res = await nativeIdeaWindows.openIdeaDraftWindow({
      draftId: nextSnapshot.draftId,
      draftVersion: nextSnapshot.draftVersion,
      createOperationId: nextSnapshot.createOperationId,
      title: nextSnapshot.title,
      snapshot: nextSnapshot,
    });
    mainEpochRef.current = res.mainEpoch;
    handoffSessionRef.current = res.windowSession || 'quickbar';
    return mergedAttachments;
  };

  const handleSave = async (draft: Draft) => {
    // If draft was handed off to standalone window or already committed by standalone window,
    // coordinate through main window's single-writer IPC so no duplicate record is ever created.
    if (draft.kind === '想法' && (draft.draftState === 'handoff' || draft.boundRecordId)) {
      const newPaths: string[] = [];
      const attachOwnerId = draft.boundRecordId ?? draft.draftId ?? crypto.randomUUID();
      if (draft.attachments.length > 0) {
        await withQuickSave(attachOwnerId, async () => {
          for (const item of draft.attachments) {
            if (!item.blob) throw new Error(`读不到附件内容：${item.name}`);
            newPaths.push(await saveAttachment(attachOwnerId, item.name, item.blob));
          }
        });
      }
      const allAttachmentPaths = Array.from(
        new Set([...(draft.savedAttachmentPaths ?? []), ...newPaths]),
      );
      const isBoundSave = Boolean(draft.boundRecordId && draft.boundRevision);
      const opId = isBoundSave
        ? (draft.saveOperationId ?? draft.createOperationId ?? crypto.randomUUID())
        : (draft.createOperationId ?? crypto.randomUUID());
      const requestId = crypto.randomUUID();
      let receiptRequestId: string | null = null;

      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const finish = (fn: () => void) => {
          if (settled) return;
          settled = true;
          void offPromise.then(off => off());
          fn();
        };

        const offPromise = nativeIdeaWindows.subscribeReplies((reply: IdeaWindowReply) => {
          if (settled) return;
          if (reply.kind === 'receipt' && (reply.requestId === receiptRequestId || reply.operationId.toLowerCase() === opId.toLowerCase())) {
            if (reply.status === 'committed') {
              finish(() => resolve());
            } else if (reply.status === 'not_found') {
              finish(() => reject(new Error('NOT_EXECUTED：主窗口确认本次保存未执行，原操作 ID 已保留，请直接重试')));
            } else {
              finish(() =>
                reject(
                  new Error(
                    reply.message ||
                      'OUTCOME_UNKNOWN：无法确认主窗口是否已完成保存（结果未知），草稿与原操作 ID 已保留，请直接重试以幂等确认',
                  ),
                ),
              );
            }
            return;
          }
          if (reply.requestId !== requestId) return;
          if (reply.kind === 'error') {
            finish(() => reject(new Error(reply.message)));
          } else {
            finish(() => resolve());
          }
        });

        void offPromise
          .then(() => {
            const session = handoffSessionRef.current || 'quickbar';
            if (isBoundSave && draft.boundRecordId && draft.boundRevision) {
              return nativeIdeaWindows.send(session, mainEpochRef.current, {
                kind: 'save',
                requestId,
                recordId: draft.boundRecordId,
                windowLabel: 'quickbar',
                windowSession: session,
                mainEpoch: mainEpochRef.current,
                operationId: opId,
                baseRevision: draft.boundRevision,
                text: draft.text,
                detailsMarkdown: draft.detailsMarkdown ?? '',
                needs: draft.needs.trim() || null,
                taskId: draft.taskId,
                attachments: allAttachmentPaths,
                at: draft.at,
              });
            }
            return nativeIdeaWindows.send(session, mainEpochRef.current, {
              kind: 'draft-create',
              requestId,
              draftId: draft.draftId ?? crypto.randomUUID(),
              draftVersion: draft.draftVersion ?? 1,
              createOperationId: opId,
              windowLabel: 'quickbar',
              windowSession: session,
              mainEpoch: mainEpochRef.current,
              text: draft.text,
              detailsMarkdown: draft.detailsMarkdown ?? '',
              needs: draft.needs.trim() || null,
              taskId: draft.taskId,
              attachments: allAttachmentPaths,
              at: draft.at,
            });
          })
          .catch(() => {
            if (settled) return;
            const session = handoffSessionRef.current || 'quickbar';
            receiptRequestId = crypto.randomUUID();
            void nativeIdeaWindows
              .send(session, mainEpochRef.current, {
                kind: 'query-receipt',
                requestId: receiptRequestId,
                operationId: opId,
                windowLabel: 'quickbar',
                windowSession: session,
                mainEpoch: mainEpochRef.current,
              })
              .catch(probeErr => {
                finish(() =>
                  reject(
                    new Error(
                      `OUTCOME_UNKNOWN：无法向主窗口回查保存回执（结果未知：${
                        probeErr instanceof Error ? probeErr.message : String(probeErr)
                      }），草稿与原操作 ID 已保留，请重试以幂等确认`,
                    ),
                  ),
                );
              });
          });
      });
      hide();
      return;
    }

    await saveLocal(draft);
    hide();
  };

  return (
    <div ref={box}>
      <QuickBar
        tasks={context.tasks}
        onHide={hide}
        onDirtyChange={onDirtyChange}
        onOpenIdeaWindow={handleOpenIdeaWindow}
        externalCommitted={externalCommitted}
        maintenanceLocked={maintenanceLocked}
        onSave={handleSave}
      />
      {guardError && <p role="alert">更新草稿检查失败：{guardError}</p>}
    </div>
  );
}

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { normalizeBody } from '../../services/ideaService';
import { canonicalJson } from '../../shared/operation';
import type {
  IdeaDraftHandoffSnapshot,
  IdeaWindowCommittedEvent,
  QuickBarDraftState,
} from '../../shared/ideaWindow';
import { Button } from '../../ui/controls/Button';
import { Chip } from '../../ui/controls/Chip';
import { Keycap } from '../../ui/controls/Keycap';
import { Segmented } from '../../ui/controls/Segmented';
import { TextArea } from '../../ui/controls/TextArea';
import { Tri2 } from '../../ui/icons/Icon';
import { SafeMarkdown } from '../../ui/marks/SafeMarkdown';
import type { DraftFields, RecordKind } from './QuickBarFields';
import { QuickBarFields } from './QuickBarFields';
import type { PendingAttachment } from './useAttachments';
import { useAttachments } from './useAttachments';
import './quickbar.css';

export interface Draft extends DraftFields {
  text: string;
  detailsMarkdown?: string;
  attachments: PendingAttachment[];
  savedAttachmentPaths?: string[];
  at: string;
  draftId?: string;
  draftVersion?: number;
  createOperationId?: string;
  saveOperationId?: string;
  draftState?: QuickBarDraftState;
  boundRecordId?: string | null;
  boundRevision?: string | null;
}

interface IdeaDraftState {
  draftId: string;
  draftVersion: number;
  createOperationId: string;
  saveOperationId: string;
  savedAttachmentPaths: string[];
  state: QuickBarDraftState;
  title: string;
  detailsMarkdown: string;
  needs: string;
  taskId: string | null;
  detailOpen: boolean;
  detailMode: 'edit' | 'preview';
  handoffBaseline: string | null;
  boundRecordId: string | null;
  boundRevision: string | null;
}

interface TodoDraftState {
  text: string;
  dueAt: string | null;
  taskId: string | null;
}

function createEmptyIdeaDraft(): IdeaDraftState {
  return {
    draftId: crypto.randomUUID(),
    draftVersion: 1,
    createOperationId: crypto.randomUUID(),
    saveOperationId: crypto.randomUUID(),
    savedAttachmentPaths: [],
    state: 'local',
    title: '',
    detailsMarkdown: '',
    needs: '',
    taskId: null,
    detailOpen: false,
    detailMode: 'edit',
    handoffBaseline: null,
    boundRecordId: null,
    boundRevision: null,
  };
}

const EMPTY_TODO_DRAFT: TodoDraftState = {
  text: '',
  dueAt: null,
  taskId: null,
};

function ideaFingerprint(d: Pick<IdeaDraftState, 'title' | 'detailsMarkdown' | 'needs' | 'taskId'>): string {
  return canonicalJson({
    title: d.title.trim(),
    detailsMarkdown: normalizeBody(d.detailsMarkdown),
    needs: d.needs.trim() || null,
    taskId: d.taskId ?? null,
  });
}

/**
 * 快速记录条：
 * - 想法模式：写单行标题，Enter 立即保存；Shift+Enter 或点「＋ 写详情」展开 Markdown 详情编辑区；Ctrl+Enter 保存；支持「↗ 去独立窗口编辑」。
 * - 待办模式：写一行或多行，Enter 保存，Shift+Enter 换行。
 * - 切换「想法 | 待办」或收起详情面板不会丢失各自的草稿（ADR 0026 §6）。
 */
export function QuickBar({
  tasks,
  onSave,
  onHide,
  onDirtyChange,
  onOpenIdeaWindow,
  externalCommitted,
  maintenanceLocked = false,
}: {
  tasks: { id: string; name: string }[];
  onSave: (draft: Draft) => Promise<void>;
  onHide: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  onOpenIdeaWindow?: (
    snapshot: IdeaDraftHandoffSnapshot,
    pendingAttachments?: PendingAttachment[],
  ) => Promise<string[] | void>;
  externalCommitted?: IdeaWindowCommittedEvent | null;
  maintenanceLocked?: boolean;
}) {
  const [kind, setKind] = useState<RecordKind>('想法');
  const [ideaDraft, setIdeaDraft] = useState<IdeaDraftState>(createEmptyIdeaDraft);
  const [todoDraft, setTodoDraft] = useState<TodoDraftState>(EMPTY_TODO_DRAFT);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const detailRef = useRef<HTMLTextAreaElement | null>(null);
  const att = useAttachments();

  const isIdea = kind === '想法';
  const currentText = isIdea ? ideaDraft.title : todoDraft.text;
  const hasIdeaContent = Boolean(
    ideaDraft.title.trim() ||
    normalizeBody(ideaDraft.detailsMarkdown).trim() ||
    ideaDraft.needs.trim(),
  );
  const hasTodoContent = Boolean(todoDraft.text.trim());

  useLayoutEffect(() => {
    if (!onDirtyChange) return;
    const dirty =
      hasIdeaContent ||
      hasTodoContent ||
      att.items.length > 0 ||
      saving ||
      ideaDraft.state === 'saving' ||
      ideaDraft.state === 'create_pending';
    onDirtyChange(dirty);
  }, [hasIdeaContent, hasTodoContent, att.items.length, saving, ideaDraft.state, onDirtyChange]);

  // QW1: Conditional draft clearing when standalone draft window commits
  useEffect(() => {
    if (!externalCommitted) return;
    if (externalCommitted.draftId && externalCommitted.draftId === ideaDraft.draftId) {
      const currentFp = ideaFingerprint(ideaDraft);
      if (ideaDraft.handoffBaseline && currentFp === ideaDraft.handoffBaseline) {
        // User did not continue editing in QuickBar after handoff -> clear & hide
        setIdeaDraft(createEmptyIdeaDraft());
        att.clear();
        onHide();
      } else {
        // User kept typing in QuickBar after handoff -> preserve newer input and bind recordId so next save updates it
        setIdeaDraft(prev => ({
          ...prev,
          state: 'committed',
          boundRecordId: externalCommitted.recordId,
          boundRevision: externalCommitted.idea?.recordRevision ?? prev.boundRevision,
        }));
      }
    }
  }, [externalCommitted]);

  const updateFields = (next: DraftFields) => {
    if (next.kind !== kind) {
      setKind(next.kind);
      setError('');
    }
    if (next.kind === '想法') {
      setIdeaDraft(prev => ({
        ...prev,
        taskId: next.taskId,
        needs: next.needs,
      }));
    } else {
      setTodoDraft(prev => ({
        ...prev,
        dueAt: next.dueAt,
        taskId: next.taskId,
      }));
    }
  };

  const fieldsValue: DraftFields = isIdea
    ? {
        kind: '想法',
        blocking: false,
        dueAt: null,
        taskId: ideaDraft.taskId,
        needs: ideaDraft.needs,
      }
    : {
        kind: '待办',
        blocking: false,
        dueAt: todoDraft.dueAt,
        taskId: todoDraft.taskId,
        needs: '',
      };

  const handleTitleChange = (val: string) => {
    if (isIdea) {
      // Single-line title for ideas: if multi-line text is pasted, put first line in title and rest in detailsMarkdown
      if (/[\r\n]/.test(val)) {
        const lines = val.replace(/\r\n?/g, '\n').split('\n');
        const firstLine = lines[0] ?? '';
        const rest = lines.slice(1).join('\n').trim();
        setIdeaDraft(prev => ({
          ...prev,
          draftVersion: prev.draftVersion + 1,
          title: firstLine,
          detailsMarkdown: rest
            ? prev.detailsMarkdown.trim()
              ? `${prev.detailsMarkdown}\n${rest}`
              : rest
            : prev.detailsMarkdown,
          detailOpen: rest ? true : prev.detailOpen,
        }));
      } else {
        setIdeaDraft(prev => ({
          ...prev,
          draftVersion: prev.draftVersion + 1,
          title: val,
        }));
      }
    } else {
      setTodoDraft(prev => ({ ...prev, text: val }));
    }
  };

  async function save() {
    if (saving || maintenanceLocked) return;
    if (isIdea) {
      let title = ideaDraft.title.trim();
      let details = ideaDraft.detailsMarkdown;
      if (!title && normalizeBody(details).trim()) {
        const lines = normalizeBody(details).split('\n');
        const firstNonEmptyIdx = lines.findIndex(l => l.trim().length > 0);
        if (firstNonEmptyIdx >= 0) {
          title = lines[firstNonEmptyIdx]!.trim();
          details = lines.slice(firstNonEmptyIdx + 1).join('\n');
        }
      }
      if (!title && !att.items.length && !ideaDraft.savedAttachmentPaths.length) return;
      setSaving(true);
      setError('');
      setIdeaDraft(prev => ({
        ...prev,
        state: prev.state === 'handoff' ? 'create_pending' : 'saving',
      }));
      try {
        await onSave({
          kind: '想法',
          blocking: false,
          dueAt: null,
          taskId: ideaDraft.taskId,
          needs: ideaDraft.needs,
          text: title,
          detailsMarkdown: normalizeBody(details),
          attachments: att.items,
          savedAttachmentPaths: ideaDraft.savedAttachmentPaths,
          at: new Date().toISOString(),
          draftId: ideaDraft.draftId,
          draftVersion: ideaDraft.draftVersion,
          createOperationId: ideaDraft.createOperationId,
          saveOperationId: ideaDraft.saveOperationId,
          draftState: ideaDraft.state,
          boundRecordId: ideaDraft.boundRecordId,
          boundRevision: ideaDraft.boundRevision,
        });
        setIdeaDraft(createEmptyIdeaDraft());
        att.clear();
      } catch (e) {
        setIdeaDraft(prev => ({
          ...prev,
          state: prev.boundRecordId ? 'committed' : prev.handoffBaseline ? 'handoff' : 'local',
        }));
        setError(`没存上：${e instanceof Error ? e.message : String(e)}`);
      } finally {
        setSaving(false);
      }
    } else {
      if (!todoDraft.text.trim() && !att.items.length) return;
      setSaving(true);
      setError('');
      try {
        await onSave({
          kind: '待办',
          blocking: false,
          dueAt: todoDraft.dueAt,
          taskId: todoDraft.taskId,
          needs: '',
          text: todoDraft.text.trim(),
          attachments: att.items,
          at: new Date().toISOString(),
        });
        setTodoDraft(EMPTY_TODO_DRAFT);
        att.clear();
      } catch (e) {
        setError(`没存上：${e instanceof Error ? e.message : String(e)}`);
      } finally {
        setSaving(false);
      }
    }
  }

  async function handleOpenStandalone() {
    if (!onOpenIdeaWindow || saving || maintenanceLocked) return;
    const baseline = ideaFingerprint(ideaDraft);
    const nextVersion = ideaDraft.draftVersion + 1;
    const snapshot: IdeaDraftHandoffSnapshot = {
      draftId: ideaDraft.draftId,
      draftVersion: nextVersion,
      createOperationId: ideaDraft.createOperationId,
      title: ideaDraft.title,
      detailsMarkdown: ideaDraft.detailsMarkdown,
      needs: ideaDraft.needs.trim() || null,
      taskId: ideaDraft.taskId,
      attachments: [...ideaDraft.savedAttachmentPaths],
      createdAt: new Date().toISOString(),
    };
    setIdeaDraft(prev => ({
      ...prev,
      draftVersion: nextVersion,
      state: 'handoff',
      handoffBaseline: baseline,
    }));
    try {
      const persistedPaths = await onOpenIdeaWindow(snapshot, att.items);
      if (Array.isArray(persistedPaths) && persistedPaths.length > 0) {
        setIdeaDraft(prev => ({
          ...prev,
          savedAttachmentPaths: Array.from(new Set([...prev.savedAttachmentPaths, ...persistedPaths])),
        }));
        att.clear();
      }
    } catch (e) {
      setError(`打不开独立窗口：${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const openDetailAndFocus = () => {
    setIdeaDraft(prev => ({ ...prev, detailOpen: true, detailMode: 'edit' }));
    setTimeout(() => detailRef.current?.focus(), 0);
  };

  return (
    <div
      className={`qb${att.over ? ' drop' : ''}`}
      data-tauri-drag-region
      onDragOver={att.onDragOver}
      onDragLeave={att.onDragLeave}
      onDrop={att.onDrop}
    >
      <div className="qb-line" data-tauri-drag-region>
        <span className="qb-tab" data-tauri-drag-region>
          <Tri2 />
        </span>
        <TextArea
          autoGrow
          maxRows={isIdea ? 2 : 10}
          autoFocus
          className="qb-input"
          aria-label="记录"
          disabled={saving || maintenanceLocked}
          placeholder={isIdea ? '记一条想法：输入单行标题（#标签 自动提取，Enter 立即保存）' : '写一行。#标签 会自动提取'}
          value={currentText}
          onChange={e => handleTitleChange(e.target.value)}
          onPaste={att.onPaste}
          onKeyDown={e => {
            if (e.key === 'Escape') {
              e.preventDefault();
              onHide();
            } else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void save();
            } else if (e.key === 'Enter' && e.shiftKey && isIdea && !e.nativeEvent.isComposing) {
              e.preventDefault();
              openDetailAndFocus();
            } else if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void save();
            }
          }}
        />
        <span className="qb-save" data-tauri-drag-region>
          {saving ? (
            '保存中…'
          ) : (
            <>
              <Keycap keys="Enter" small />
              保存
            </>
          )}
        </span>
      </div>

      <QuickBarFields
        value={fieldsValue}
        onChange={updateFields}
        tasks={tasks}
        detailOpen={isIdea && ideaDraft.detailOpen}
        hasDetailDraft={Boolean(ideaDraft.detailsMarkdown.trim())}
        disabled={saving || maintenanceLocked}
        onToggleDetail={() =>
          setIdeaDraft(prev => ({
            ...prev,
            detailOpen: !prev.detailOpen,
          }))
        }
      />

      {isIdea && ideaDraft.detailOpen && (
        <div className="qb-detail-pane" data-tauri-drag-region>
          <div className="qb-detail-bar" data-tauri-drag-region>
            <span className="k" data-tauri-drag-region>
              MARKDOWN DETAIL<em>想法详情（可选 · 列表只显示单行标题，点进详情才渲染正文）</em>
            </span>
            <div className="qb-detail-acts">
              <Segmented
                label="详情编辑或预览"
                value={ideaDraft.detailMode}
                onChange={detailMode => setIdeaDraft(prev => ({ ...prev, detailMode }))}
                options={[
                  { value: 'edit', label: '编辑' },
                  { value: 'preview', label: '预览' },
                ]}
              />
              {onOpenIdeaWindow && (
                <Button
                  size="sm"
                  className="id-open-win"
                  disabled={saving || maintenanceLocked}
                  title="将当前快速记录的想法草稿带到独立窗口中编辑"
                  onClick={() => void handleOpenStandalone()}
                >
                  <svg viewBox="0 0 16 16" aria-hidden="true">
                    <path
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      d="M6.8 9.2 2.5 13.5M2.5 9.3v4.2h4.2M9.2 6.8l4.3-4.3M9.3 2.5h4.2v4.2"
                    />
                  </svg>
                  去独立窗口编辑
                </Button>
              )}
            </div>
          </div>

          {ideaDraft.detailMode === 'edit' ? (
            <textarea
              ref={detailRef}
              aria-label="想法详情"
              className="inp qb-detail-ta"
              rows={4}
              disabled={saving || maintenanceLocked}
              placeholder="在这里补充长文上下文、清单、代码块或 http/https 链接（支持 Markdown）..."
              value={ideaDraft.detailsMarkdown}
              onChange={e =>
                setIdeaDraft(prev => ({
                  ...prev,
                  draftVersion: prev.draftVersion + 1,
                  detailsMarkdown: e.target.value,
                }))
              }
              onKeyDown={e => {
                if (e.key === 'Escape') {
                  e.preventDefault();
                  onHide();
                } else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void save();
                }
              }}
            />
          ) : (
            <div className="md-body qb-detail-pv">
              {ideaDraft.detailsMarkdown.trim() ? (
                <SafeMarkdown markdown={ideaDraft.detailsMarkdown} />
              ) : (
                <span style={{ color: 'var(--mute)' }}>暂无可预览的详情内容。</span>
              )}
            </div>
          )}

          <div className="qb-detail-foot" data-tauri-drag-region>
            <span className="qb-detail-hint" data-tauri-drag-region>
              收起详情或切到「待办」不会丢失已写草稿 · 外链仅放行 http/https
            </span>
            <div className="qb-detail-acts">
              <Button
                size="sm"
                disabled={saving || maintenanceLocked}
                onClick={() => setIdeaDraft(createEmptyIdeaDraft())}
              >
                清空草稿
              </Button>
              <Button
                size="sm"
                tone="ink"
                disabled={saving || maintenanceLocked || (!ideaDraft.title.trim() && !ideaDraft.detailsMarkdown.trim())}
                onClick={() => void save()}
              >
                保存想法
              </Button>
            </div>
          </div>
        </div>
      )}

      {att.items.length > 0 && (
        <div className="qb-files" data-tauri-drag-region>
          {att.items.map(a => (
            <Chip key={a.id} label={a.name} onRemove={() => att.remove(a.id)} />
          ))}
        </div>
      )}
      {error && (
        <p className="qb-msg" role="alert" data-tauri-drag-region>
          {error}
        </p>
      )}
    </div>
  );
}

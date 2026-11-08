import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { normalizeBody } from '../../../services/ideaService';
import type { IdeaDocument, UpdateIdeaInput } from '../../../services/ideaService';
import type { IdeaInitialEditDraft } from '../../../shared/ideaWindow';
import { Button } from '../../../ui/controls/Button';
import { Chip } from '../../../ui/controls/Chip';
import { Segmented } from '../../../ui/controls/Segmented';
import { TextInput } from '../../../ui/controls/TextInput';
import { Icon } from '../../../ui/icons/Icon';
import { SafeMarkdown } from '../../../ui/marks/SafeMarkdown';
import type { DoneIdeaView, IdeaView } from './types';
import './backpack.css';

const days = (iso: string) => Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
const pad = (n: number) => String(n).padStart(2, '0');
/** 完成于：今天 10:12 / 昨天 21:30 / 11-03 15:00（按本机日历日）。 */
export function doneWhen(iso: string, now = new Date()): string {
  const d = new Date(iso), hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86_400_000);
  return diff === 0 ? `今天 ${hm}` : diff === 1 ? `昨天 ${hm}` : `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${hm}`;
}
/** 谁标的完成（沿用操作历史的来源叫法）：手动 / MCP · 调用方 / CLI · 调用方。 */
export function doneBy(by: DoneIdeaView['completedBy']): string {
  if (by.kind === 'manual') return '手动';
  return `${by.kind === 'mcp' ? 'MCP' : by.kind === 'cli' ? 'CLI' : '自动化'} · ${by.agent ?? '未识别'}`;
}

export type IdeaPoolView = 'pool' | 'done';

/**
 * 想法池分页（0.3.3 升级：列表只显示单行标题摘要与「详情」标记；点条目进详情阅读/编辑 Markdown；详情内可从新窗口打开）。
 */
export function IdeaPool({
  ideas,
  done,
  limit,
  onConvert,
  onDelete,
  onComplete,
  onUncomplete,
  onLoadIdeaDetails,
  onUpdateIdea,
  onOpenIdeaWindow,
  onEditDirtyChange,
  maintenanceLocked = false,
}: {
  ideas: IdeaView[];
  done: DoneIdeaView[];
  limit: number;
  onConvert: (idea: IdeaView) => void;
  onDelete: (idea: { id: string; text: string }) => void;
  onComplete: (idea: IdeaView) => void;
  onUncomplete: (idea: DoneIdeaView) => void;
  onLoadIdeaDetails?: (id: string) => Promise<IdeaDocument>;
  onUpdateIdea?: (input: UpdateIdeaInput) => Promise<IdeaDocument>;
  onOpenIdeaWindow?: (recordId: string, title?: string, initialDraft?: IdeaInitialEditDraft | null) => void;
  onEditDirtyChange?: (dirty: boolean) => void;
  maintenanceLocked?: boolean;
}) {
  const [view, setView] = useState<IdeaPoolView>('pool');
  const [q, setQ] = useState('');
  const [need, setNeed] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [doc, setDoc] = useState<IdeaDocument | null>(null);
  const [loadingDoc, setLoadingDoc] = useState(false);
  const [mode, setMode] = useState<'read' | 'edit'>('read');
  const [editTab, setEditTab] = useState<'edit' | 'preview'>('edit');
  const [editTitle, setEditTitle] = useState('');
  const [editDetails, setEditDetails] = useState('');
  const [editNeeds, setEditNeeds] = useState('');
  const [baseRevision, setBaseRevision] = useState('');
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [conflictDoc, setConflictDoc] = useState<IdeaDocument | null>(null);

  const selectedIdRef = useRef<string | null>(null);
  const modeRef = useRef<'read' | 'edit'>('read');
  const docRef = useRef<IdeaDocument | null>(null);
  const editTitleRef = useRef('');
  const editDetailsRef = useRef('');
  const editNeedsRef = useRef('');
  const savingRef = useRef(false);
  selectedIdRef.current = selectedId;
  modeRef.current = mode;
  docRef.current = doc;
  editTitleRef.current = editTitle;
  editDetailsRef.current = editDetails;
  editNeedsRef.current = editNeeds;
  savingRef.current = saving;

  const syncDirtyNow = useCallback(() => {
    if (savingRef.current) {
      onEditDirtyChange?.(true);
      return;
    }
    const curDoc = docRef.current;
    if (!selectedIdRef.current || modeRef.current !== 'edit' || !curDoc) {
      onEditDirtyChange?.(false);
      return;
    }
    const dirty =
      editTitleRef.current.trim() !== curDoc.text.trim() ||
      normalizeBody(editDetailsRef.current) !== normalizeBody(curDoc.detailsMarkdown) ||
      (editNeedsRef.current.trim() || null) !== (curDoc.needs ?? null);
    onEditDirtyChange?.(dirty);
  }, [onEditDirtyChange]);

  const needs = useMemo(() => [...new Set(ideas.map(i => i.needs).filter((n): n is string => !!n))], [ideas]);
  const active = ideas.filter(i => i.pool === '活跃池').length;
  const hit = (i: { text: string; tags: string[]; needs: string | null }) =>
    !q || (i.text + ' ' + i.tags.join(' ') + ' ' + (i.needs ?? '')).toLowerCase().includes(q.toLowerCase());
  const shown = ideas.filter(i => (!need || i.needs === need) && hit(i));
  const shownDone = done.filter(hit);

  const summaryPoolItem = useMemo(() => ideas.find(i => i.id === selectedId) ?? null, [ideas, selectedId]);
  const summaryDoneItem = useMemo(() => done.find(i => i.id === selectedId) ?? null, [done, selectedId]);
  const summaryRevision = summaryPoolItem?.recordRevision ?? summaryDoneItem?.recordRevision ?? null;

  const isDirty = useMemo(() => {
    if (!selectedId || mode !== 'edit' || !doc) return false;
    return (
      editTitle.trim() !== doc.text.trim() ||
      normalizeBody(editDetails) !== normalizeBody(doc.detailsMarkdown) ||
      (editNeeds.trim() || null) !== (doc.needs ?? null)
    );
  }, [selectedId, mode, doc, editTitle, editDetails, editNeeds]);

  useEffect(() => {
    onEditDirtyChange?.(isDirty || saving);
    return () => {
      onEditDirtyChange?.(false);
    };
  }, [isDirty, saving, onEditDirtyChange]);

  const fallbackDocFromSummary = useCallback(
    (id: string): IdeaDocument | null => {
      const p = ideas.find(x => x.id === id);
      if (p) {
        return {
          id: p.id,
          text: p.text,
          detailsMarkdown: '',
          hasDetails: Boolean(p.hasDetails),
          tags: p.tags,
          needs: p.needs,
          attachments: [],
          pool: p.pool,
          createdAt: p.createdAt,
          lastTouchedAt: p.lastTouchedAt,
          completedAt: null,
          completedBy: null,
          recordRevision: p.recordRevision ?? 'ir3:summary',
          taskId: null,
        };
      }
      const d = done.find(x => x.id === id);
      if (d) {
        return {
          id: d.id,
          text: d.text,
          detailsMarkdown: '',
          hasDetails: Boolean(d.hasDetails),
          tags: d.tags,
          needs: d.needs,
          attachments: [],
          pool: '已完成',
          createdAt: d.completedAt,
          lastTouchedAt: d.completedAt,
          completedAt: d.completedAt,
          completedBy: d.completedBy,
          recordRevision: d.recordRevision ?? 'ir3:summary',
          taskId: null,
        };
      }
      return null;
    },
    [ideas, done],
  );

  // Load full IdeaDocument when opening detail view
  useEffect(() => {
    if (!selectedId) {
      setDoc(null);
      setMode('read');
      setErrorMsg(null);
      setConflictDoc(null);
      return;
    }
    // If the item was deleted externally and we are not dirty in edit mode, return to list
    if (!summaryPoolItem && !summaryDoneItem && !isDirty) {
      setSelectedId(null);
      return;
    }

    let cancelled = false;
    if (!onLoadIdeaDetails) {
      const fb = fallbackDocFromSummary(selectedId);
      setDoc(fb);
      if (fb && mode === 'read') {
        setEditTitle(fb.text);
        setEditDetails(fb.detailsMarkdown);
        setEditNeeds(fb.needs ?? '');
        setBaseRevision(fb.recordRevision);
      }
      return;
    }

    setLoadingDoc(prev => (!doc || doc.id !== selectedId ? true : prev));
    void onLoadIdeaDetails(selectedId)
      .then(loaded => {
        if (cancelled) return;
        setLoadingDoc(false);
        setDoc(loaded);
        if (mode === 'read' || !isDirty) {
          setEditTitle(loaded.text);
          setEditDetails(loaded.detailsMarkdown);
          setEditNeeds(loaded.needs ?? '');
          setBaseRevision(loaded.recordRevision);
          setConflictDoc(null);
        } else if (loaded.recordRevision !== baseRevision) {
          setConflictDoc(loaded);
        }
      })
      .catch(err => {
        if (cancelled) return;
        setLoadingDoc(false);
        setErrorMsg(err instanceof Error ? err.message : String(err));
      });

    return () => {
      cancelled = true;
    };
  }, [selectedId, summaryRevision]);

  // Escape handler inside Idea Detail view so Esc returns to list instead of closing the drawer
  useEffect(() => {
    if (!selectedId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) {
        e.stopPropagation();
        e.preventDefault();
        if (mode === 'edit' && !isDirty) {
          setMode('read');
        } else if (mode === 'read') {
          setSelectedId(null);
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && mode === 'edit') {
        e.stopPropagation();
        e.preventDefault();
        void handleSave();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  });

  const enterEdit = () => {
    if (!doc) return;
    editTitleRef.current = doc.text;
    editDetailsRef.current = doc.detailsMarkdown;
    editNeedsRef.current = doc.needs ?? '';
    modeRef.current = 'edit';
    setEditTitle(doc.text);
    setEditDetails(doc.detailsMarkdown);
    setEditNeeds(doc.needs ?? '');
    setBaseRevision(doc.recordRevision);
    setEditTab('edit');
    setErrorMsg(null);
    setConflictDoc(null);
    setMode('edit');
    syncDirtyNow();
  };

  async function handleSave() {
    if (!doc || !onUpdateIdea || saving || maintenanceLocked) return;
    const trimmed = editTitleRef.current.trim();
    const normDetails = normalizeBody(editDetailsRef.current);
    if (!trimmed && !normDetails.trim() && (doc.attachments?.length ?? 0) === 0) {
      setErrorMsg('想法内容或附件不能为空');
      return;
    }
    if (/[\r\n]/.test(trimmed)) {
      setErrorMsg('想法标题必须是单行文本，多行内容请写在下方 Markdown 详情中');
      return;
    }
    savingRef.current = true;
    setSaving(true);
    syncDirtyNow();
    setErrorMsg(null);
    try {
      const updated = await onUpdateIdea({
        id: doc.id,
        text: trimmed,
        detailsMarkdown: editDetailsRef.current,
        needs: editNeedsRef.current.trim() || null,
        expectedRecordRevision: baseRevision,
      });
      docRef.current = updated;
      editTitleRef.current = updated.text;
      editDetailsRef.current = updated.detailsMarkdown;
      editNeedsRef.current = updated.needs ?? '';
      modeRef.current = 'read';
      setDoc(updated);
      setEditTitle(updated.text);
      setEditDetails(updated.detailsMarkdown);
      setEditNeeds(updated.needs ?? '');
      setBaseRevision(updated.recordRevision);
      setConflictDoc(null);
      setMode('read');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(msg);
      if (onLoadIdeaDetails && (msg.includes('版本已变化') || msg.includes('冲突'))) {
        void onLoadIdeaDetails(doc.id).then(latest => setConflictDoc(latest)).catch(() => {});
      }
    } finally {
      savingRef.current = false;
      setSaving(false);
      syncDirtyNow();
    }
  }

  if (selectedId) {
    const revShort = (mode === 'edit' ? baseRevision : doc?.recordRevision)?.replace(/^ir3:/, '').slice(0, 8) || '1';
    return (
      <div className="id-detail-view">
        <div className="bp-dhead">
          <button
            type="button"
            className="bp-backlink"
            onClick={() => {
              if (mode === 'edit') {
                setMode('read');
                setErrorMsg(null);
              } else {
                setSelectedId(null);
              }
            }}
          >
            <Icon name="chev" />
            {mode === 'edit' ? '返回阅读态' : '背包 · 想法池'}
          </button>
          <span className="bp-hint">
            {mode === 'edit'
              ? '编辑态 · Ctrl+Enter 保存修改'
              : '阅读态 · 点链接直接打开浏览器 · Esc 返回想法池'}
          </span>

          {mode === 'read' ? (
            <div className="bp-dhead-acts">
              {onOpenIdeaWindow && doc && (
                <Button
                  size="sm"
                  className="id-open-win"
                  title="从独立窗口打开当前想法笔记"
                  onClick={() => onOpenIdeaWindow(doc.id, doc.text, null)}
                >
                  <svg viewBox="0 0 16 16" aria-hidden="true">
                    <path
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      d="M6.8 9.2 2.5 13.5M2.5 9.3v4.2h4.2M9.2 6.8l4.3-4.3M9.3 2.5h4.2v4.2"
                    />
                  </svg>
                  新窗口打开
                </Button>
              )}
              {onUpdateIdea && (
                <Button size="sm" disabled={loadingDoc || !doc} onClick={enterEdit}>
                  编辑
                </Button>
              )}
              {summaryPoolItem && (
                <>
                  <Button
                    size="sm"
                    tone="ink"
                    disabled={summaryPoolItem.pool === '已转任务'}
                    onClick={() => onConvert(summaryPoolItem)}
                  >
                    {summaryPoolItem.pool === '已转任务' ? '已转' : '转成任务'}
                  </Button>
                  {summaryPoolItem.pool === '活跃池' && (
                    <Button
                      size="sm"
                      className="id-ok"
                      title="这个想法已经做到了，不用再转成任务"
                      onClick={() => {
                        setSelectedId(null);
                        onComplete(summaryPoolItem);
                      }}
                    >
                      <Icon name="check" />
                      完成
                    </Button>
                  )}
                </>
              )}
              {summaryDoneItem && (
                <Button
                  size="sm"
                  title="放回想法池"
                  onClick={() => {
                    setSelectedId(null);
                    onUncomplete(summaryDoneItem);
                  }}
                >
                  撤销完成
                </Button>
              )}
              {doc && (
                <Button
                  size="sm"
                  tone="danger"
                  onClick={() => onDelete({ id: doc.id, text: doc.text })}
                >
                  删除
                </Button>
              )}
            </div>
          ) : (
            <div className="bp-dhead-acts">
              {onOpenIdeaWindow && doc && (
                <Button
                  size="sm"
                  className="id-open-win"
                  title="将当前未保存编辑草稿带入独立窗口编辑（抽屉内草稿继续保留）"
                  onClick={() =>
                    onOpenIdeaWindow(doc.id, editTitle.trim() || doc.text, {
                      title: editTitle,
                      detailsMarkdown: editDetails,
                      needs: editNeeds.trim() || null,
                      baseRevision,
                      editMode: true,
                    })
                  }
                >
                  <svg viewBox="0 0 16 16" aria-hidden="true">
                    <path
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      d="M6.8 9.2 2.5 13.5M2.5 9.3v4.2h4.2M9.2 6.8l4.3-4.3M9.3 2.5h4.2v4.2"
                    />
                  </svg>
                  新窗口打开
                </Button>
              )}
              <Button
                size="sm"
                disabled={saving || maintenanceLocked}
                onClick={() => {
                  modeRef.current = 'read';
                  setMode('read');
                  setErrorMsg(null);
                  setConflictDoc(null);
                  syncDirtyNow();
                }}
              >
                取消
              </Button>
              <Button
                size="sm"
                tone="ink"
                disabled={
                  saving ||
                  maintenanceLocked ||
                  (!editTitle.trim() && !normalizeBody(editDetails).trim() && (doc?.attachments?.length ?? 0) === 0)
                }
                onClick={() => void handleSave()}
              >
                {saving ? '保存中…' : '保存修改'}
              </Button>
            </div>
          )}
        </div>

        <article className="bp-detail id-sheet">
          {loadingDoc && !doc ? (
            <div className="id-body-wrap">正在读取想法详情…</div>
          ) : mode === 'read' && doc ? (
            <div>
              <div className="bp-dtop">
                <span className="k">
                  IDEA DETAIL · 想法详情 <em>REV {revShort}</em>
                </span>
                <h3>{doc.text}</h3>
                <div className="ls-meta">
                  {doc.tags.map(t => (
                    <span key={t}>#{t}</span>
                  ))}
                  {doc.needs && <span>需要：{doc.needs}</span>}
                  {doc.pool === '已完成' && doc.completedAt ? (
                    <span className="id-when">完成于 {doneWhen(doc.completedAt)}</span>
                  ) : (
                    <span>
                      {doc.pool === '已转任务'
                        ? '已转任务'
                        : doc.lastTouchedAt
                        ? `${days(doc.lastTouchedAt)} 天没动`
                        : ''}
                    </span>
                  )}
                </div>
              </div>
              <div className="id-body-wrap">
                {doc.detailsMarkdown.trim() ? (
                  <SafeMarkdown markdown={doc.detailsMarkdown} />
                ) : (
                  <div className="id-empty-box">
                    <span>这条想法还没有补充 Markdown 详情正文。</span>
                    {onUpdateIdea && (
                      <Button size="sm" onClick={enterEdit}>
                        添加详情
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="id-edit-form">
              {conflictDoc && (
                <div className="id-conflict-banner" role="alert">
                  <span>
                    该想法已在其他窗口或外部更新（最新版本 <code>{conflictDoc.recordRevision.slice(0, 12)}</code>）。你的未保存草稿已保留。
                  </span>
                  <div className="bp-dhead-acts">
                    <Button
                      size="sm"
                      onClick={() => {
                        setDoc(conflictDoc);
                        setEditTitle(conflictDoc.text);
                        setEditDetails(conflictDoc.detailsMarkdown);
                        setEditNeeds(conflictDoc.needs ?? '');
                        setBaseRevision(conflictDoc.recordRevision);
                        setConflictDoc(null);
                        setErrorMsg(null);
                      }}
                    >
                      加载外部最新版
                    </Button>
                    <Button
                      size="sm"
                      tone="ink"
                      onClick={() => {
                        setDoc(conflictDoc);
                        setBaseRevision(conflictDoc.recordRevision);
                        setConflictDoc(null);
                        setErrorMsg(null);
                      }}
                    >
                      基于最新版继续保存
                    </Button>
                  </div>
                </div>
              )}

              {errorMsg && !conflictDoc && (
                <div className="id-conflict-banner" role="alert">
                  <span>{errorMsg}</span>
                </div>
              )}

              <div className="id-edit-field">
                <label htmlFor="edit-idea-title">想法标题（单行，支持 #标签）</label>
                <TextInput
                  id="edit-idea-title"
                  value={editTitle}
                  disabled={saving || maintenanceLocked}
                  onChange={e => {
                    if (maintenanceLocked) return;
                    editTitleRef.current = e.target.value;
                    setEditTitle(e.target.value);
                    syncDirtyNow();
                  }}
                />
              </div>

              <div className="id-edit-field">
                <label htmlFor="edit-idea-needs">需要什么资源（可选）</label>
                <TextInput
                  id="edit-idea-needs"
                  placeholder="例如：整块时间、外接显示器..."
                  value={editNeeds}
                  disabled={saving || maintenanceLocked}
                  onChange={e => {
                    if (maintenanceLocked) return;
                    editNeedsRef.current = e.target.value;
                    setEditNeeds(e.target.value);
                    syncDirtyNow();
                  }}
                />
              </div>

              <div className="id-edit-field">
                <div className="id-edit-head">
                  <label htmlFor="edit-idea-detail">
                    Markdown 详情（可选，支持标题、列表、代码块、引用与 http/https 链接）
                  </label>
                  <Segmented
                    label="详情编辑或预览"
                    value={editTab}
                    onChange={setEditTab}
                    options={[
                      { value: 'edit', label: '编辑' },
                      { value: 'preview', label: '预览' },
                    ]}
                  />
                </div>
                {editTab === 'edit' ? (
                  <textarea
                    id="edit-idea-detail"
                    className="inp id-edit-ta"
                    rows={8}
                    disabled={saving || maintenanceLocked}
                    placeholder="在这里编写 Markdown 想法详情..."
                    value={editDetails}
                    onChange={e => {
                      if (maintenanceLocked) return;
                      editDetailsRef.current = e.target.value;
                      setEditDetails(e.target.value);
                      syncDirtyNow();
                    }}
                  />
                ) : (
                  <div className="md-body id-edit-pv">
                    {editDetails.trim() ? (
                      <SafeMarkdown markdown={editDetails} />
                    ) : (
                      <span style={{ color: 'var(--mute)' }}>暂无可预览的 Markdown 内容。</span>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </article>
      </div>
    );
  }

  const seg = (
    <div className="seg id-seg" role="radiogroup" aria-label="想法池视图">
      {(
        [
          ['pool', '想法池', 'IDEAS', ideas.length],
          ['done', '已完成', 'DONE', done.length],
        ] as const
      ).map(([v, cn, en, n]) => (
        <button key={v} type="button" role="radio" aria-checked={view === v} onClick={() => setView(v)}>
          {cn}
          <i>{en}</i>
          <b>{n}</b>
        </button>
      ))}
    </div>
  );

  return (
    <>
      <div className="bp-tools">
        {seg}
        <TextInput aria-label="筛选想法" placeholder="筛选：文字、#标签" value={q} onChange={e => setQ(e.target.value)} />
        {view === 'pool' ? (
          <span className={`bp-cnt${active > limit ? ' over' : ''}`}>
            <b>{active}</b>/ {limit}
          </span>
        ) : (
          <span className="bp-cnt">
            <b>{done.length}</b>个已完成
          </span>
        )}
      </div>
      {view === 'pool' && (
        <>
          {needs.length > 0 && (
            <div className="bp-tools">
              {needs.map(n => (
                <Chip key={n} label={`需要：${n}`} on={need === n} onClick={() => setNeed(need === n ? null : n)} />
              ))}
            </div>
          )}
          {active > limit && (
            <p className="ls-warn">
              想法池超出上限 {active - limit} 个。下次回顾时会用擂台两两对决，压回到 {limit} 个以内。
            </p>
          )}
          {shown.length === 0 ? (
            <p className="ls-empty">
              {ideas.length ? '没有符合筛选的想法。' : '还没有想法。在快速记录条里写一行，不选类型就是想法。'}
            </p>
          ) : (
            <ul className="ls">
              {shown.map(i => (
                <li
                  key={i.id}
                  className={`ls-item id-clickable${i.pool === '已转任务' ? ' done' : ''}`}
                  tabIndex={0}
                  onClick={() => setSelectedId(i.id)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && e.target === e.currentTarget) setSelectedId(i.id);
                  }}
                >
                  <div>
                    <b>{i.text}</b>
                    <div className="ls-meta">
                      {i.hasDetails && <span className="id-has-detail">详情</span>}
                      {i.tags.map(t => (
                        <span key={t}>#{t}</span>
                      ))}
                      {i.needs && <span>需要：{i.needs}</span>}
                      <span>{i.pool === '已转任务' ? '已转任务' : `${days(i.lastTouchedAt)} 天没动`}</span>
                    </div>
                  </div>
                  <div className="ls-acts" onClick={e => e.stopPropagation()}>
                    <Button size="sm" tone="ink" disabled={i.pool === '已转任务'} onClick={() => onConvert(i)}>
                      {i.pool === '已转任务' ? '已转' : '转成任务'}
                    </Button>
                    {i.pool === '活跃池' && (
                      <Button
                        size="sm"
                        className="id-ok"
                        title="这个想法已经做到了，不用再转成任务"
                        onClick={() => onComplete(i)}
                      >
                        <Icon name="check" />
                        完成
                      </Button>
                    )}
                    <Button size="sm" tone="danger" onClick={() => onDelete(i)}>
                      删除
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {view === 'done' && (
        <>
          {shownDone.length === 0 ? (
            <p className="ls-empty">
              {done.length ? '没有符合筛选的已完成想法。' : '还没有完成的想法。想法池里做到了的，点〔完成〕就收到这里。'}
            </p>
          ) : (
            <ul className="ls">
              {shownDone.map(i => (
                <li
                  key={i.id}
                  className="ls-item id-done id-clickable"
                  tabIndex={0}
                  onClick={() => setSelectedId(i.id)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && e.target === e.currentTarget) setSelectedId(i.id);
                  }}
                >
                  <div>
                    <b>
                      <span className="id-tick" aria-hidden="true">
                        <Icon name="check" />
                      </span>
                      {i.text}
                    </b>
                    <div className="ls-meta">
                      {i.hasDetails && <span className="id-has-detail">详情</span>}
                      {i.tags.map(t => (
                        <span key={t}>#{t}</span>
                      ))}
                      <span className="id-when">完成于 {doneWhen(i.completedAt)}</span>
                      <span className={`id-by${i.completedBy.kind === 'manual' ? '' : ' auto'}`}>
                        {doneBy(i.completedBy)}
                      </span>
                    </div>
                  </div>
                  <div className="ls-acts" onClick={e => e.stopPropagation()}>
                    <Button size="sm" title="放回想法池" onClick={() => onUncomplete(i)}>
                      撤销完成
                    </Button>
                    <Button size="sm" tone="danger" onClick={() => onDelete(i)}>
                      删除
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {done.length > 0 && (
            <p className="id-note">
              按完成时间从新到旧。撤销完成会放回想法池（算一次「动过」，重新从 0 天计）；池子满了也能放回，下次回顾时用擂台压回上限。
            </p>
          )}
        </>
      )}
    </>
  );
}

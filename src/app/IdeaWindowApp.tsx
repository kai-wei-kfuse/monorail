import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { extractRecordTags, normalizeBody } from '../domain/record/record';
import { ideaDraftHandoffSnapshotSchema } from '../shared/ideaWindow';
import type {
  IdeaDraftHandoffSnapshot,
  IdeaWindowCommittedEvent,
  IdeaWindowDocument,
  IdeaWindowReply,
} from '../shared/ideaWindow';
import {
  createDraftCheckTracker,
  getCurrentWindowLabel,
  nativeIdeaWindows,
} from '../platform/ideaWindows';
import type { IdeaWindowHello } from '../platform/ideaWindows';
import { subscribeQuickbarContext } from '../platform/quickbarContext';
import { Button } from '../ui/controls/Button';
import { Segmented } from '../ui/controls/Segmented';
import { TextInput } from '../ui/controls/TextInput';
import { SafeMarkdown } from '../ui/marks/SafeMarkdown';
import { Dialog } from '../ui/overlay/Dialog';
import '../ui/styles/base.css';
import './ideaWindow.css';

function countExternalLinks(md: string): number {
  const matches = md.match(/https?:\/\/[^\s)>\]]+/gi);
  return matches ? matches.length : 0;
}

function computeIsDirty(
  curMode: 'read' | 'edit',
  curTitle: string,
  curDetails: string,
  curNeeds: string,
  curIdea: IdeaWindowDocument | null,
  curDraftMeta: IdeaDraftHandoffSnapshot | null,
  curBoundRecordId: string | null,
): boolean {
  if (curMode !== 'edit') return false;
  const unbound = Boolean(curDraftMeta && !curBoundRecordId && !curIdea);
  if (unbound) {
    return Boolean(
      curTitle.trim() ||
        normalizeBody(curDetails).trim() ||
        curNeeds.trim() ||
        (curDraftMeta?.attachments?.length ?? 0) > 0,
    );
  }
  if (!curIdea) return false;
  return (
    curTitle.trim() !== curIdea.text.trim() ||
    normalizeBody(curDetails) !== normalizeBody(curIdea.detailsMarkdown) ||
    (curNeeds.trim() || null) !== (curIdea.needs ?? null)
  );
}

export function IdeaWindowApp() {
  const [hello, setHello] = useState<IdeaWindowHello | null>(null);
  const [loading, setLoading] = useState(true);
  const [idea, setIdea] = useState<IdeaWindowDocument | null>(null);
  const [draftMeta, setDraftMeta] = useState<IdeaDraftHandoffSnapshot | null>(null);
  const [boundRecordId, setBoundRecordId] = useState<string | null>(null);
  const [mode, setMode] = useState<'read' | 'edit'>('read');
  const [editTab, setEditTab] = useState<'edit' | 'preview'>('edit');
  const [editTitle, setEditTitle] = useState('');
  const [editDetails, setEditDetails] = useState('');
  const [editNeeds, setEditNeeds] = useState('');
  const [baseRevision, setBaseRevision] = useState('');
  const [nextOperationId, setNextOperationId] = useState<string>(() => crypto.randomUUID());
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [conflictIdea, setConflictIdea] = useState<IdeaWindowDocument | null>(null);
  const [deletedRemotely, setDeletedRemotely] = useState(false);
  const [dirtyDialogOpen, setDirtyDialogOpen] = useState(false);
  const [maintenanceLocked, setMaintenanceLocked] = useState(false);
  const [syncText, setSyncText] = useState('已与主窗口同步');

  const viewSeqRef = useRef(0);
  const mainEpochRef = useRef(0);
  const windowSessionRef = useRef('');
  const labelRef = useRef('');
  const helloRef = useRef<IdeaWindowHello | null>(null);
  const boundRecordIdRef = useRef<string | null>(null);
  const draftMetaRef = useRef<IdeaDraftHandoffSnapshot | null>(null);
  const baseRevisionRef = useRef('');
  const ideaRef = useRef<IdeaWindowDocument | null>(null);
  const modeRef = useRef<'read' | 'edit'>('read');
  const savingRef = useRef(false);
  const loadReqIdRef = useRef<string | null>(null);
  const editStateRef = useRef<{ title: string; details: string; needs: string }>({
    title: '',
    details: '',
    needs: '',
  });
  const pendingReqRef = useRef<{
    requestId: string;
    receiptRequestId: string | null;
    operationId: string;
    submittedTitle: string;
    submittedDetails: string;
    submittedNeeds: string | null;
    closeAfterSave: boolean;
  } | null>(null);

  helloRef.current = hello;
  boundRecordIdRef.current = boundRecordId;
  draftMetaRef.current = draftMeta;
  baseRevisionRef.current = baseRevision;
  ideaRef.current = idea;
  modeRef.current = mode;
  savingRef.current = saving;
  editStateRef.current = { title: editTitle, details: editDetails, needs: editNeeds };

  const isDraftUnbound = Boolean(draftMeta && !boundRecordId && !idea);
  const hasAttachments = Boolean((idea?.attachments?.length ?? draftMeta?.attachments?.length ?? 0) > 0);
  const hasSavableContent = Boolean(
    editTitle.trim() || normalizeBody(editDetails).trim() || hasAttachments,
  );

  const isDirty = useMemo(
    () => computeIsDirty(mode, editTitle, editDetails, editNeeds, idea, draftMeta, boundRecordId),
    [mode, editTitle, editDetails, editNeeds, idea, draftMeta, boundRecordId],
  );

  const dirtyRef = useRef(false);
  // Synchronously keep dirtyRef up to date on every render and input change (never lagging behind useEffect)
  dirtyRef.current = isDirty || saving;

  const updateEditTitle = (val: string) => {
    editStateRef.current = { ...editStateRef.current, title: val };
    dirtyRef.current =
      computeIsDirty(modeRef.current, val, editStateRef.current.details, editStateRef.current.needs, ideaRef.current, draftMetaRef.current, boundRecordIdRef.current) ||
      savingRef.current;
    setEditTitle(val);
  };

  const updateEditDetails = (val: string) => {
    editStateRef.current = { ...editStateRef.current, details: val };
    dirtyRef.current =
      computeIsDirty(modeRef.current, editStateRef.current.title, val, editStateRef.current.needs, ideaRef.current, draftMetaRef.current, boundRecordIdRef.current) ||
      savingRef.current;
    setEditDetails(val);
  };

  const updateEditNeeds = (val: string) => {
    editStateRef.current = { ...editStateRef.current, needs: val };
    dirtyRef.current =
      computeIsDirty(modeRef.current, editStateRef.current.title, editStateRef.current.details, val, ideaRef.current, draftMetaRef.current, boundRecordIdRef.current) ||
      savingRef.current;
    setEditNeeds(val);
  };

  // Accent color sync
  useEffect(() => {
    const off = subscribeQuickbarContext(ctx => {
      if (ctx.accent) document.documentElement.style.setProperty('--yellow', ctx.accent);
    });
    return () => { void off.then(fn => fn()); };
  }, []);

  // Maintenance draft check listener (D1)
  useEffect(() => {
    const tracker = createDraftCheckTracker();
    const offCheck = listen('update-check-draft', event => {
      const myLabel = labelRef.current || getCurrentWindowLabel();
      const reqId = tracker.acceptCheck(event.payload, myLabel);
      if (!reqId || !myLabel) return;
      setMaintenanceLocked(true);
      const isSaving = savingRef.current;
      const latestDirty =
        computeIsDirty(
          modeRef.current,
          editStateRef.current.title,
          editStateRef.current.details,
          editStateRef.current.needs,
          ideaRef.current,
          draftMetaRef.current,
          boundRecordIdRef.current,
        ) || isSaving;
      dirtyRef.current = latestDirty;
      void nativeIdeaWindows
        .ackDraftCheck(myLabel, latestDirty, reqId, { saving: isSaving })
        .catch(() => {});
    });
    const offRestore = listen('draft-check-restore', event => {
      const myLabel = labelRef.current || getCurrentWindowLabel();
      if (!tracker.acceptRestore(event.payload, myLabel)) return;
      setMaintenanceLocked(false);
    });
    return () => {
      void offCheck.then(fn => fn());
      void offRestore.then(fn => fn());
    };
  }, []);

  // Subscribe to replies & committed broadcasts once per session lifecycle, then run hello handshake once
  useEffect(() => {
    let active = true;

    const applyCommittedSave = (committedIdea: IdeaWindowDocument, nextOpId: string, syncLabel: string) => {
      const pending = pendingReqRef.current;
      const shouldClose = pending?.closeAfterSave ?? false;
      const cur = editStateRef.current;
      const unchangedSinceSubmit = pending
        ? cur.title.trim() === pending.submittedTitle &&
          normalizeBody(cur.details) === pending.submittedDetails &&
          (cur.needs.trim() ? cur.needs.trim() : null) === pending.submittedNeeds
        : true;

      pendingReqRef.current = null;
      savingRef.current = false;
      setSaving(false);
      setLoading(false);
      ideaRef.current = committedIdea;
      setIdea(committedIdea);
      boundRecordIdRef.current = committedIdea.id;
      setBoundRecordId(committedIdea.id);
      baseRevisionRef.current = committedIdea.recordRevision;
      setBaseRevision(committedIdea.recordRevision);
      setNextOperationId(nextOpId);
      setErrorMsg(null);
      setConflictIdea(null);

      if (unchangedSinceSubmit) {
        editStateRef.current = {
          title: committedIdea.text,
          details: committedIdea.detailsMarkdown,
          needs: committedIdea.needs ?? '',
        };
        setEditTitle(committedIdea.text);
        setEditDetails(committedIdea.detailsMarkdown);
        setEditNeeds(committedIdea.needs ?? '');
        modeRef.current = 'read';
        setMode('read');
        dirtyRef.current = false;
        setSyncText(syncLabel);
        if (shouldClose) {
          void nativeIdeaWindows.closeIdeaWindow(labelRef.current);
        }
      } else {
        // User continued typing while save was in flight: preserve newer edits in edit mode, rebase onto new revision
        setSyncText('已保存上一版本（当前新输入已保留）');
      }
    };

    const handleReply = (reply: IdeaWindowReply) => {
      if (!active) return;
      if (mainEpochRef.current > 0 && reply.mainEpoch !== mainEpochRef.current) {
        if (reply.kind === 'error' && reply.code === 'EPOCH_MISMATCH') {
          pendingReqRef.current = null;
          savingRef.current = false;
          setSaving(false);
          setLoading(false);
          setErrorMsg(reply.message);
        }
        return;
      }

      if (reply.kind === 'loaded') {
        const expectedRecordId = boundRecordIdRef.current ?? helloRef.current?.recordId ?? null;
        if (
          expectedRecordId
            ? reply.idea.id !== expectedRecordId
            : Boolean(loadReqIdRef.current && reply.requestId !== loadReqIdRef.current)
        ) {
          return;
        }
        if (reply.viewSeq < viewSeqRef.current) return;
        viewSeqRef.current = reply.viewSeq;
        setLoading(false);
        ideaRef.current = reply.idea;
        setIdea(reply.idea);
        boundRecordIdRef.current = reply.idea.id;
        setBoundRecordId(reply.idea.id);
        setNextOperationId(reply.nextOperationId);
        setErrorMsg(null);
        setConflictIdea(null);
        setDeletedRemotely(false);
        if (reply.initialDraft) {
          editStateRef.current = {
            title: reply.initialDraft.title,
            details: reply.initialDraft.detailsMarkdown,
            needs: reply.initialDraft.needs ?? '',
          };
          setEditTitle(reply.initialDraft.title);
          setEditDetails(reply.initialDraft.detailsMarkdown);
          setEditNeeds(reply.initialDraft.needs ?? '');
          baseRevisionRef.current = reply.initialDraft.baseRevision;
          setBaseRevision(reply.initialDraft.baseRevision);
          const nextMode = reply.initialDraft.editMode ? 'edit' : 'read';
          modeRef.current = nextMode;
          setMode(nextMode);
        } else {
          editStateRef.current = {
            title: reply.idea.text,
            details: reply.idea.detailsMarkdown,
            needs: reply.idea.needs ?? '',
          };
          setEditTitle(reply.idea.text);
          setEditDetails(reply.idea.detailsMarkdown);
          setEditNeeds(reply.idea.needs ?? '');
          baseRevisionRef.current = reply.idea.recordRevision;
          setBaseRevision(reply.idea.recordRevision);
          modeRef.current = 'read';
          setMode('read');
        }
        setSyncText('已与主窗口同步');
        return;
      }

      if (reply.kind === 'draft-loaded') {
        const expectedDraftId = draftMetaRef.current?.draftId ?? helloRef.current?.draftId ?? null;
        if (
          expectedDraftId
            ? reply.draft.draftId !== expectedDraftId
            : Boolean(loadReqIdRef.current && reply.requestId !== loadReqIdRef.current)
        ) {
          return;
        }
        if (reply.viewSeq < viewSeqRef.current) return;
        viewSeqRef.current = reply.viewSeq;
        setLoading(false);
        const prevSnap = draftMetaRef.current;
        draftMetaRef.current = reply.draft;
        setDraftMeta(reply.draft);
        // Only initialize edit fields if user has not already modified them since initial snapshot
        const cur = editStateRef.current;
        const userAlreadyEdited =
          prevSnap !== null &&
          (cur.title !== prevSnap.title ||
            cur.details !== prevSnap.detailsMarkdown ||
            cur.needs !== (prevSnap.needs ?? ''));
        if (!userAlreadyEdited) {
          editStateRef.current = {
            title: reply.draft.title,
            details: reply.draft.detailsMarkdown,
            needs: reply.draft.needs ?? '',
          };
          setEditTitle(reply.draft.title);
          setEditDetails(reply.draft.detailsMarkdown);
          setEditNeeds(reply.draft.needs ?? '');
        }
        setNextOperationId(reply.nextOperationId);
        modeRef.current = 'edit';
        setMode('edit');
        setSyncText('新建想法草稿 · 保存后写入主窗口');
        return;
      }

      if (reply.kind === 'saved' || reply.kind === 'draft-created') {
        const pending = pendingReqRef.current;
        if (!pending || reply.requestId !== pending.requestId) return;
        viewSeqRef.current = Math.max(viewSeqRef.current, reply.viewSeq);
        applyCommittedSave(reply.idea, reply.nextOperationId, '已保存并同步');
        return;
      }

      if (reply.kind === 'receipt') {
        const pending = pendingReqRef.current;
        if (
          !pending ||
          (reply.requestId !== pending.receiptRequestId &&
            reply.operationId.toLowerCase() !== pending.operationId.toLowerCase())
        ) {
          return;
        }
        if (reply.status === 'committed' && reply.idea) {
          applyCommittedSave(reply.idea, crypto.randomUUID(), '已通过幂等回执确认保存');
        } else if (reply.status === 'not_found') {
          pendingReqRef.current = null;
          savingRef.current = false;
          setSaving(false);
          setErrorMsg('NOT_EXECUTED：主窗口确认本次保存未执行，原操作 ID 已保留，请直接重试保存');
        } else {
          pendingReqRef.current = null;
          savingRef.current = false;
          setSaving(false);
          setErrorMsg(
            reply.message ||
              'OUTCOME_UNKNOWN：无法确认主窗口是否已完成保存（结果未知），草稿与原操作 ID 已保留，请直接重试以幂等确认',
          );
        }
        return;
      }

      if (reply.kind === 'error') {
        const pending = pendingReqRef.current;
        if (pending) {
          if (reply.requestId !== pending.requestId && reply.requestId !== pending.receiptRequestId) {
            return;
          }
        } else if (loadReqIdRef.current && reply.requestId !== loadReqIdRef.current) {
          return;
        }
        pendingReqRef.current = null;
        savingRef.current = false;
        setSaving(false);
        setLoading(false);
        if (reply.code === 'CONFLICT' && reply.currentIdea) {
          ideaRef.current = reply.currentIdea;
          setIdea(reply.currentIdea);
          boundRecordIdRef.current = reply.currentIdea.id;
          setBoundRecordId(reply.currentIdea.id);
          setConflictIdea(reply.currentIdea);
          setErrorMsg(reply.message);
        } else {
          setErrorMsg(reply.message);
        }
      }
    };

    const handleCommitted = (event: IdeaWindowCommittedEvent) => {
      if (!active) return;
      const targetRecordId = boundRecordIdRef.current ?? helloRef.current?.recordId ?? null;
      const curDraft = draftMetaRef.current;
      const matchesRecord = Boolean(targetRecordId && event.recordId === targetRecordId);
      const matchesDraft = Boolean(curDraft && event.draftId && event.draftId === curDraft.draftId);
      if (!matchesRecord && !matchesDraft) return;

      // Never auto-rebind to a different mainEpoch
      if (mainEpochRef.current > 0 && event.mainEpoch !== mainEpochRef.current) {
        setSyncText('主窗口会话已更新，请重新打开窗口同步');
        return;
      }
      if (event.viewSeq <= viewSeqRef.current) {
        return;
      }
      viewSeqRef.current = event.viewSeq;

      if (event.kind === 'deleted') {
        setDeletedRemotely(true);
        setSyncText('该想法已在其他入口被删除');
        return;
      }

      if (event.idea) {
        const wasDirty =
          computeIsDirty(
            modeRef.current,
            editStateRef.current.title,
            editStateRef.current.details,
            editStateRef.current.needs,
            ideaRef.current,
            draftMetaRef.current,
            boundRecordIdRef.current,
          ) || savingRef.current;
        boundRecordIdRef.current = event.idea.id;
        setBoundRecordId(event.idea.id);
        ideaRef.current = event.idea;
        setIdea(event.idea);
        if (!wasDirty) {
          editStateRef.current = {
            title: event.idea.text,
            details: event.idea.detailsMarkdown,
            needs: event.idea.needs ?? '',
          };
          setEditTitle(event.idea.text);
          setEditDetails(event.idea.detailsMarkdown);
          setEditNeeds(event.idea.needs ?? '');
          baseRevisionRef.current = event.idea.recordRevision;
          setBaseRevision(event.idea.recordRevision);
          dirtyRef.current = false;
          setConflictIdea(null);
          setSyncText('已同步最新变更');
        } else if (event.idea.recordRevision !== baseRevisionRef.current) {
          dirtyRef.current = true;
          setConflictIdea(event.idea);
          setSyncText('检测到外部新版本（未覆盖当前草稿）');
        }
      }
    };

    const offReplies = nativeIdeaWindows.subscribeReplies(handleReply);
    const offCommitted = nativeIdeaWindows.subscribeCommitted(handleCommitted);

    void (async () => {
      try {
        await offReplies;
        await offCommitted;
        const info = await nativeIdeaWindows.hello();
        if (!active) return;
        helloRef.current = info;
        setHello(info);
        labelRef.current = info.label;
        windowSessionRef.current = info.windowSession;
        mainEpochRef.current = info.mainEpoch;

        if (info.kind === 'record' && info.recordId) {
          boundRecordIdRef.current = info.recordId;
          setBoundRecordId(info.recordId);
          const reqId = crypto.randomUUID();
          loadReqIdRef.current = reqId;
          await nativeIdeaWindows.send(info.windowSession, info.mainEpoch, {
            kind: 'load',
            requestId: reqId,
            recordId: info.recordId,
            windowLabel: info.label,
            windowSession: info.windowSession,
            mainEpoch: info.mainEpoch,
          });
        } else if (info.kind === 'draft' && info.draftId) {
          const parsedSnap = ideaDraftHandoffSnapshotSchema.safeParse(info.draftSnapshot);
          if (parsedSnap.success) {
            draftMetaRef.current = parsedSnap.data;
            setDraftMeta(parsedSnap.data);
            editStateRef.current = {
              title: parsedSnap.data.title,
              details: parsedSnap.data.detailsMarkdown,
              needs: parsedSnap.data.needs ?? '',
            };
            setEditTitle(parsedSnap.data.title);
            setEditDetails(parsedSnap.data.detailsMarkdown);
            setEditNeeds(parsedSnap.data.needs ?? '');
            modeRef.current = 'edit';
            setMode('edit');
            setLoading(false);
          }
          const reqId = crypto.randomUUID();
          loadReqIdRef.current = reqId;
          await nativeIdeaWindows.send(info.windowSession, info.mainEpoch, {
            kind: 'draft-load',
            requestId: reqId,
            draftId: info.draftId,
            windowLabel: info.label,
            windowSession: info.windowSession,
            mainEpoch: info.mainEpoch,
          });
        }
      } catch (err) {
        if (!active) return;
        setLoading(false);
        setErrorMsg(err instanceof Error ? err.message : String(err));
      }
    })();

    return () => {
      active = false;
      void offReplies.then(fn => fn());
      void offCommitted.then(fn => fn());
    };
  }, []);

  const enterEdit = useCallback(() => {
    if (!idea || deletedRemotely || maintenanceLocked) return;
    editStateRef.current = {
      title: idea.text,
      details: idea.detailsMarkdown,
      needs: idea.needs ?? '',
    };
    setEditTitle(idea.text);
    setEditDetails(idea.detailsMarkdown);
    setEditNeeds(idea.needs ?? '');
    baseRevisionRef.current = idea.recordRevision;
    setBaseRevision(idea.recordRevision);
    setEditTab('edit');
    setErrorMsg(null);
    setConflictIdea(null);
    modeRef.current = 'edit';
    setMode('edit');
  }, [idea, deletedRemotely, maintenanceLocked]);

  const performSave = useCallback(async (closeAfterSave = false) => {
    if (saving || maintenanceLocked) return;
    const trimmedTitle = editTitle.trim();
    const normalizedDetails = normalizeBody(editDetails);
    const hasAttach = Boolean((idea?.attachments?.length ?? draftMeta?.attachments?.length ?? 0) > 0);
    if (!trimmedTitle && !normalizedDetails.trim() && !hasAttach) {
      setErrorMsg('想法内容或附件不能为空');
      return;
    }
    if (/[\r\n]/.test(trimmedTitle)) {
      setErrorMsg('想法标题必须是单行文本，多行内容请写在下方 Markdown 详情中');
      return;
    }

    savingRef.current = true;
    dirtyRef.current = true;
    setSaving(true);
    setErrorMsg(null);
    const requestId = crypto.randomUUID();
    const at = new Date().toISOString();
    const opId = isDraftUnbound && draftMeta ? draftMeta.createOperationId : nextOperationId;
    const trimmedNeeds = editNeeds.trim() ? editNeeds.trim() : null;
    pendingReqRef.current = {
      requestId,
      receiptRequestId: null,
      operationId: opId,
      submittedTitle: trimmedTitle,
      submittedDetails: normalizedDetails,
      submittedNeeds: trimmedNeeds,
      closeAfterSave,
    };

    try {
      if (isDraftUnbound && draftMeta) {
        await nativeIdeaWindows.send(windowSessionRef.current, mainEpochRef.current, {
          kind: 'draft-create',
          requestId,
          draftId: draftMeta.draftId,
          draftVersion: draftMeta.draftVersion,
          createOperationId: opId,
          windowLabel: labelRef.current,
          windowSession: windowSessionRef.current,
          mainEpoch: mainEpochRef.current,
          text: trimmedTitle,
          detailsMarkdown: editDetails,
          needs: trimmedNeeds,
          taskId: draftMeta.taskId,
          attachments: draftMeta.attachments,
          at,
        });
      } else if (boundRecordId) {
        await nativeIdeaWindows.send(windowSessionRef.current, mainEpochRef.current, {
          kind: 'save',
          requestId,
          recordId: boundRecordId,
          windowLabel: labelRef.current,
          windowSession: windowSessionRef.current,
          mainEpoch: mainEpochRef.current,
          operationId: opId,
          baseRevision,
          text: trimmedTitle,
          detailsMarkdown: editDetails,
          needs: trimmedNeeds,
          at,
        });
      }
    } catch {
      try {
        const receiptReqId = crypto.randomUUID();
        if (pendingReqRef.current) {
          pendingReqRef.current.receiptRequestId = receiptReqId;
        }
        await nativeIdeaWindows.send(windowSessionRef.current, mainEpochRef.current, {
          kind: 'query-receipt',
          requestId: receiptReqId,
          operationId: opId,
          windowLabel: labelRef.current,
          windowSession: windowSessionRef.current,
          mainEpoch: mainEpochRef.current,
        });
      } catch (probeErr) {
        pendingReqRef.current = null;
        savingRef.current = false;
        setSaving(false);
        setErrorMsg(
          `OUTCOME_UNKNOWN：无法向主窗口回查保存回执（结果未知：${
            probeErr instanceof Error ? probeErr.message : String(probeErr)
          }），草稿与原操作 ID 已保留，请重试以幂等确认`,
        );
      }
    }
  }, [saving, maintenanceLocked, editTitle, editDetails, editNeeds, idea?.attachments?.length, isDraftUnbound, draftMeta, boundRecordId, nextOperationId, baseRevision]);

  const requestClose = useCallback(() => {
    if (maintenanceLocked) return;
    if (isDirty) {
      setDirtyDialogOpen(true);
      return;
    }
    void nativeIdeaWindows.closeIdeaWindow(labelRef.current);
  }, [maintenanceLocked, isDirty]);

  const cancelEdit = useCallback(() => {
    if (isDraftUnbound) {
      requestClose();
      return;
    }
    if (isDirty) {
      setDirtyDialogOpen(true);
      return;
    }
    if (idea) {
      updateEditTitle(idea.text);
      updateEditDetails(idea.detailsMarkdown);
      updateEditNeeds(idea.needs ?? '');
      baseRevisionRef.current = idea.recordRevision;
      setBaseRevision(idea.recordRevision);
    }
    setErrorMsg(null);
    setConflictIdea(null);
    modeRef.current = 'read';
    setMode('read');
  }, [isDraftUnbound, isDirty, idea, requestClose, updateEditTitle, updateEditDetails, updateEditNeeds]);

  useEffect(() => {
    const offCloseReq = listen<{ targetLabel?: string }>('idea-window-close-requested', event => {
      if (event.payload?.targetLabel && labelRef.current && event.payload.targetLabel !== labelRef.current) {
        return;
      }
      requestClose();
    });
    return () => {
      void offCloseReq.then(fn => fn());
    };
  }, [requestClose]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (dirtyDialogOpen) return;
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && mode === 'edit') {
        e.preventDefault();
        void performSave(false);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        if (mode === 'edit' && !isDraftUnbound && !isDirty) {
          modeRef.current = 'read';
          setMode('read');
        } else {
          requestClose();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [dirtyDialogOpen, mode, isDraftUnbound, isDirty, performSave, requestClose]);

  const currentDetails = mode === 'edit' ? editDetails : (idea?.detailsMarkdown ?? '');
  const currentTags = mode === 'edit' ? extractRecordTags(editTitle) : (idea?.tags ?? []);
  const charCount = normalizeBody(currentDetails).trim().length;
  const linkCount = countExternalLinks(currentDetails);

  return (
    <div className="note-win-root" role="region" aria-label="想法笔记窗口">
      <div className="note-win-stage">
        <header className="note-win-head" data-tauri-drag-region>
          <div className="note-win-toprow" data-tauri-drag-region>
            <div className="note-win-topmeta" data-tauri-drag-region>
              <span className="k" data-tauri-drag-region>
                {mode === 'edit'
                  ? isDraftUnbound
                    ? '新建想法 · 独立窗口编辑中'
                    : '编辑中 · 按 Ctrl+Enter 保存'
                  : '阅读视图 · 点击链接在浏览器中打开'}
              </span>
              {idea?.pool && (
                <span className="k" data-tauri-drag-region>
                  所属池<em>{idea.pool}</em>
                </span>
              )}
            </div>

            {mode === 'read' ? (
              <div className="note-win-acts">
                <Button size="sm" disabled={deletedRemotely || maintenanceLocked || loading} onClick={enterEdit}>
                  编辑
                </Button>
                <Button size="sm" disabled={maintenanceLocked} onClick={requestClose}>
                  关闭窗口
                </Button>
              </div>
            ) : (
              <div className="note-win-acts">
                <Segmented
                  label="编辑或预览"
                  value={editTab}
                  onChange={setEditTab}
                  options={[
                    { value: 'edit', label: '编辑' },
                    { value: 'preview', label: '预览' },
                  ]}
                />
                <Button size="sm" disabled={saving || maintenanceLocked} onClick={cancelEdit}>
                  取消
                </Button>
                <Button size="sm" tone="ink" disabled={saving || maintenanceLocked || !hasSavableContent} onClick={() => void performSave(false)}>
                  {saving ? '保存中…' : isDraftUnbound ? '保存想法' : '保存修改'}
                </Button>
              </div>
            )}
          </div>

          {conflictIdea && (
            <div className="note-win-conflict" role="alert">
              <span>
                该想法已在其他入口更新，你的未保存草稿已保留。
              </span>
              <div className="note-win-conflict-acts">
                <Button
                  size="sm"
                  onClick={() => {
                    updateEditTitle(conflictIdea.text);
                    updateEditDetails(conflictIdea.detailsMarkdown);
                    updateEditNeeds(conflictIdea.needs ?? '');
                    baseRevisionRef.current = conflictIdea.recordRevision;
                    setBaseRevision(conflictIdea.recordRevision);
                    setConflictIdea(null);
                    setErrorMsg(null);
                  }}
                >
                  加载外部最新版
                </Button>
                <Button
                  size="sm"
                  tone="ink"
                  onClick={() => {
                    baseRevisionRef.current = conflictIdea.recordRevision;
                    setBaseRevision(conflictIdea.recordRevision);
                    setConflictIdea(null);
                    setErrorMsg(null);
                  }}
                >
                  基于最新版继续保存
                </Button>
              </div>
            </div>
          )}

          {deletedRemotely && (
            <div className="note-win-conflict" role="alert">
              <span>该想法已在主窗口被删除。</span>
            </div>
          )}

          {errorMsg && !conflictIdea && (
            <div className="note-win-conflict" role="alert">
              <span>{errorMsg}</span>
            </div>
          )}

          <div className="note-win-title-row">
            {mode === 'read' ? (
              <h2 className="note-win-title">{loading ? '正在加载想法笔记…' : idea?.text ?? ''}</h2>
            ) : (
              <TextInput
                aria-label="想法单行标题"
                className="note-win-title-inp"
                placeholder="想法单行标题（可用 #标签）..."
                value={editTitle}
                disabled={saving || maintenanceLocked}
                onChange={e => updateEditTitle(e.target.value)}
              />
            )}
          </div>

          <div className="note-win-meta">
            <span>标签：</span>
            {currentTags.length > 0 ? (
              currentTags.map(t => (
                <span key={t} className="tag-pill">
                  #{t}
                </span>
              ))
            ) : (
              <span>（在标题中输入 #标签 自动识别）</span>
            )}
            <span>需要：</span>
            {mode === 'read' ? (
              <span>{idea?.needs || '未设置'}</span>
            ) : (
              <TextInput
                aria-label="需要的资源"
                className="note-win-needs-inp"
                placeholder="例如：整块时间、安静下午..."
                value={editNeeds}
                disabled={saving || maintenanceLocked}
                onChange={e => updateEditNeeds(e.target.value)}
              />
            )}
          </div>
        </header>

        <div className="note-win-body">
          {loading ? (
            <div className="note-win-read">正在同步想法详情…</div>
          ) : mode === 'read' ? (
            <div className="note-win-read">
              {idea?.detailsMarkdown.trim() ? (
                <SafeMarkdown markdown={idea.detailsMarkdown} />
              ) : (
                <div className="note-win-empty">
                  <span>这条想法还没有补充 Markdown 详情正文。</span>
                  <Button size="sm" disabled={deletedRemotely || maintenanceLocked} onClick={enterEdit}>
                    添加详情
                  </Button>
                </div>
              )}
            </div>
          ) : editTab === 'edit' ? (
            <textarea
              aria-label="Markdown 想法笔记"
              className="note-win-ta"
              placeholder="在这里编写 Markdown 想法笔记（支持标题、列表、代码块、引用与 http/https 链接）..."
              value={editDetails}
              disabled={saving || maintenanceLocked}
              onChange={e => updateEditDetails(e.target.value)}
            />
          ) : (
            <div className="note-win-pv">
              {editDetails.trim() ? (
                <SafeMarkdown markdown={editDetails} />
              ) : (
                <span style={{ color: 'var(--mute)' }}>暂无可预览的 Markdown 内容。</span>
              )}
            </div>
          )}
        </div>
      </div>

      <footer className="note-win-dock" data-tauri-drag-region>
        <div className="note-win-dock-left" data-tauri-drag-region>
          <span className="k" data-tauri-drag-region>
            想法笔记<em>{charCount} 字 · {linkCount} 个链接</em>
          </span>
          <span data-tauri-drag-region>
            快捷键：Ctrl+Enter 保存 · Esc 关闭
          </span>
        </div>
        <div className="note-win-dock-right" data-tauri-drag-region>
          <span data-tauri-drag-region>{syncText}</span>
        </div>
      </footer>

      {dirtyDialogOpen && (
        <Dialog
          en="UNSAVED CHANGES"
          title="有未保存的想法笔记修改"
          onClose={() => setDirtyDialogOpen(false)}
          footer={
            <>
              <Button onClick={() => setDirtyDialogOpen(false)}>继续编辑</Button>
              <Button
                tone="danger"
                onClick={() => {
                  setDirtyDialogOpen(false);
                  void nativeIdeaWindows.closeIdeaWindow(labelRef.current);
                }}
              >
                放弃修改并关闭
              </Button>
              <Button
                tone="ink"
                disabled={!hasSavableContent || saving}
                onClick={() => {
                  setDirtyDialogOpen(false);
                  void performSave(true);
                }}
              >
                保存并关闭
              </Button>
            </>
          }
        >
          <p>当前窗口中有尚未保存的标题或 Markdown 详情草稿。直接关闭窗口将丢失这些未保存内容。</p>
        </Dialog>
      )}
    </div>
  );
}

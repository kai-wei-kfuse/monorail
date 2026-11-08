import { canonicalJson } from '../shared/operation';
import { createIdeaData, updateIdeaData } from '../shared/application';
import {
  ideaDraftHandoffSnapshotSchema,
  ideaWindowCommandSchema,
} from '../shared/ideaWindow';
import type {
  IdeaDraftHandoffSnapshot,
  IdeaInitialEditDraft,
  IdeaWindowCommand,
  IdeaWindowCommittedEvent,
  IdeaWindowDocument,
  IdeaWindowReply,
} from '../shared/ideaWindow';
import type { IdeaWindowsPort } from '../platform/ideaWindows';
import { nativeIdeaWindows } from '../platform/ideaWindows';
import type { Ctx } from '../services/commit';
import { readOperation, runOperation } from '../services/commit';
import type { HistoryIntent } from '../shared/history';
import * as ideas from '../services/ideaService';
import type { IdeaDocument, IdeaSummaryDto } from '../services/ideaService';
import { appStore } from '../store/appStore';

interface FrozenReceipt {
  operationId: string;
  kind: 'save' | 'draft-create';
  fingerprint: string;
  recordId: string;
  draftId?: string;
  draftVersion?: number;
  committedIdea: IdeaWindowDocument;
}

function toWindowDocument(doc: IdeaDocument): IdeaWindowDocument {
  return {
    id: doc.id,
    text: doc.text,
    detailsMarkdown: doc.detailsMarkdown,
    tags: doc.tags,
    needs: doc.needs,
    attachments: doc.attachments,
    pool: doc.pool,
    createdAt: doc.createdAt,
    lastTouchedAt: doc.lastTouchedAt,
    completedAt: doc.completedAt,
    completedBy: doc.completedBy,
    recordRevision: doc.recordRevision,
    taskId: doc.taskId,
  };
}

function reconstructWindowDocFromReceipt(
  summary: IdeaSummaryDto,
  parsedInput: { details_markdown?: string; task_id?: string | null },
  command: 'create_idea' | 'update_idea',
): IdeaWindowDocument | null {
  if (summary.has_details && typeof parsedInput.details_markdown !== 'string') {
    return null;
  }
  const detailsMarkdown = typeof parsedInput.details_markdown === 'string' ? parsedInput.details_markdown : '';
  const isCreate = command === 'create_idea';
  const knownNotCompleted = isCreate || summary.pool !== '已完成';
  return {
    id: summary.id,
    text: summary.title,
    detailsMarkdown,
    tags: summary.tags,
    needs: summary.needs,
    attachments: summary.attachments,
    pool: summary.pool,
    createdAt: summary.created_at,
    lastTouchedAt: summary.last_touched_at,
    completedAt: knownNotCompleted ? null : undefined,
    completedBy: knownNotCompleted ? null : undefined,
    recordRevision: summary.record_revision,
    taskId: isCreate ? (parsedInput.task_id ?? null) : (parsedInput.task_id !== undefined ? parsedInput.task_id : undefined),
  };
}

function saveNormalizedInput(cmd: Extract<IdeaWindowCommand, { kind: 'save' }>) {
  return ideas.normalizeUpdateIdeaOperationInput({
    idea_id: cmd.recordId,
    record_revision: cmd.baseRevision,
    title: cmd.text,
    details_markdown: cmd.detailsMarkdown,
    needs: cmd.needs,
    task_id: cmd.taskId,
    attachments: cmd.attachments,
  });
}

function draftCreateNormalizedInput(cmd: Extract<IdeaWindowCommand, { kind: 'draft-create' }>) {
  return ideas.normalizeCreateIdeaOperationInput({
    title: cmd.text,
    details_markdown: cmd.detailsMarkdown,
    needs: cmd.needs,
    task_id: cmd.taskId,
    attachments: cmd.attachments,
  });
}

export interface IdeaWindowController {
  openIdeaWindow(recordId: string, title?: string, initialDraft?: IdeaInitialEditDraft | null): Promise<void>;
  openIdeaDraftWindow(snapshot: IdeaDraftHandoffSnapshot): Promise<void>;
  dispose(): void;
}

export function connectIdeaWindows(
  ctx: Ctx,
  port: IdeaWindowsPort = nativeIdeaWindows,
  onError?: (error: unknown) => void,
): IdeaWindowController {
  let viewSeq = 0;
  let disposed = false;
  const pendingInitialDrafts = new Map<string, IdeaInitialEditDraft>();
  const pendingDraftHandoffs = new Map<string, IdeaDraftHandoffSnapshot>();
  const draftToRecordId = new Map<string, string>();
  const committedReceipts = new Map<string, FrozenReceipt>();
  const lastBroadcastSig = new Map<string, string>();

  const recordSignature = (r: { id: string; text: string; pool?: string | null; completedAt?: string | null; lastTouchedAt?: string | null; recordRevision?: string }) =>
    `${r.recordRevision ?? ''}|${r.text}|${r.pool ?? ''}|${r.completedAt ?? ''}|${r.lastTouchedAt ?? ''}`;

  const currentProjectedIdeas = () => {
    const bp = appStore.getState().backpack;
    return [
      ...bp.ideas.map(i => ({ id: i.id, text: i.text, pool: i.pool, completedAt: null, lastTouchedAt: i.lastTouchedAt, recordRevision: i.recordRevision })),
      ...bp.doneIdeas.map(i => ({ id: i.id, text: i.text, pool: '已完成', completedAt: i.completedAt, lastTouchedAt: i.completedAt, recordRevision: i.recordRevision })),
    ];
  };

  // Initialize signatures from current store projection
  for (const r of currentProjectedIdeas()) {
    lastBroadcastSig.set(r.id, recordSignature(r));
  }

  const safeReply = async (targetLabel: string, payload: IdeaWindowReply) => {
    try {
      await port.reply(targetLabel, payload);
    } catch {
      // Target window may have closed before receiving the reply
    }
  };

  const safeBroadcast = async (payload: IdeaWindowCommittedEvent) => {
    try {
      await port.notifyCommitted(payload);
    } catch (error) {
      onError?.(error);
    }
  };

  const handleCommand = async (rawCommand: IdeaWindowCommand) => {
    const parsed = ideaWindowCommandSchema.safeParse(rawCommand);
    if (!parsed.success) return;
    const command = parsed.data;

    if (command.mainEpoch !== ctx.mainEpoch) {
      await safeReply(command.windowLabel, {
        kind: 'error',
        requestId: command.requestId,
        mainEpoch: ctx.mainEpoch,
        code: 'EPOCH_MISMATCH',
        message: '主窗口会话已更新，请重新加载当前想法',
        currentIdea: null,
      });
      return;
    }

    if (command.kind === 'load') {
      try {
        const doc = await ideas.getIdeaDetails(ctx, command.recordId);
        const idea = toWindowDocument(doc);
        const initialDraft = pendingInitialDrafts.get(command.recordId) ?? null;
        pendingInitialDrafts.delete(command.recordId);
        await safeReply(command.windowLabel, {
          kind: 'loaded',
          requestId: command.requestId,
          mainEpoch: ctx.mainEpoch,
          viewSeq: ++viewSeq,
          nextOperationId: crypto.randomUUID(),
          idea,
          initialDraft,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await safeReply(command.windowLabel, {
          kind: 'error',
          requestId: command.requestId,
          mainEpoch: ctx.mainEpoch,
          code: message.includes('找不到') || message.includes('不存在') || message.includes('IDEA_NOT_FOUND') ? 'NOT_FOUND' : 'INTERNAL',
          message,
          currentIdea: null,
        });
      }
      return;
    }

    if (command.kind === 'draft-load') {
      const rebindId = draftToRecordId.get(command.draftId);
      if (rebindId) {
        try {
          const doc = await ideas.getIdeaDetails(ctx, rebindId);
          await safeReply(command.windowLabel, {
            kind: 'loaded',
            requestId: command.requestId,
            mainEpoch: ctx.mainEpoch,
            viewSeq: ++viewSeq,
            nextOperationId: crypto.randomUUID(),
            idea: toWindowDocument(doc),
            initialDraft: null,
          });
          return;
        } catch {
          // Fall through to draft snapshot
        }
      }
      const draft = pendingDraftHandoffs.get(command.draftId);
      if (!draft) {
        await safeReply(command.windowLabel, {
          kind: 'error',
          requestId: command.requestId,
          mainEpoch: ctx.mainEpoch,
          code: 'NOT_FOUND',
          message: '找不到待编辑的想法草稿',
          currentIdea: null,
        });
        return;
      }
      await safeReply(command.windowLabel, {
        kind: 'draft-loaded',
        requestId: command.requestId,
        mainEpoch: ctx.mainEpoch,
        viewSeq: ++viewSeq,
        nextOperationId: crypto.randomUUID(),
        draft,
      });
      return;
    }

    if (command.kind === 'query-receipt') {
      const opId = command.operationId.toLowerCase();
      const existing = committedReceipts.get(opId);
      if (existing) {
        await safeReply(command.windowLabel, {
          kind: 'receipt',
          requestId: command.requestId,
          mainEpoch: ctx.mainEpoch,
          operationId: command.operationId,
          status: 'committed',
          idea: existing.committedIdea,
        });
        return;
      }
      try {
        const durable = await readOperation(ctx, opId);
        if (!durable) {
          await safeReply(command.windowLabel, {
            kind: 'receipt',
            requestId: command.requestId,
            mainEpoch: ctx.mainEpoch,
            operationId: command.operationId,
            status: 'not_found',
            idea: null,
          });
          return;
        }
        if (durable.command === 'create_idea' || durable.command === 'update_idea') {
          const parsedData = durable.command === 'create_idea'
            ? createIdeaData.safeParse(durable.data)
            : updateIdeaData.safeParse(durable.data);
          if (parsedData.success) {
            const parsedInput = JSON.parse(durable.input) as {
              details_markdown?: string;
              task_id?: string | null;
            };
            const frozenIdea = reconstructWindowDocFromReceipt(
              parsedData.data.idea,
              parsedInput,
              durable.command,
            );
            if (frozenIdea) {
              await safeReply(command.windowLabel, {
                kind: 'receipt',
                requestId: command.requestId,
                mainEpoch: ctx.mainEpoch,
                operationId: command.operationId,
                status: 'committed',
                idea: frozenIdea,
              });
              return;
            }
          }
        }
        await safeReply(command.windowLabel, {
          kind: 'receipt',
          requestId: command.requestId,
          mainEpoch: ctx.mainEpoch,
          operationId: command.operationId,
          status: 'unknown',
          idea: null,
          message: '操作回执存在但内容无法解析为完整想法快照，结果未知',
        });
        return;
      } catch (error) {
        onError?.(error);
        const message = error instanceof Error ? error.message : String(error);
        await safeReply(command.windowLabel, {
          kind: 'receipt',
          requestId: command.requestId,
          mainEpoch: ctx.mainEpoch,
          operationId: command.operationId,
          status: 'unknown',
          idea: null,
          message: `读取操作回执失败，结果未知：${message}`,
        });
        return;
      }
    }

    if (command.kind === 'save') {
      const opId = (command.operationId ?? crypto.randomUUID()).toLowerCase();
      const normalized = saveNormalizedInput(command);
      const fp = canonicalJson(normalized);

      try {
        const intent: HistoryIntent = {
          action: 'idea.edit',
          subject: { type: 'record', id: normalized.idea_id },
          source: { kind: 'manual', via: command.windowLabel === 'quickbar' ? 'quickbar' : 'idea-window' },
        };
        let freshWindowDoc: IdeaWindowDocument | null = null;
        const result = await runOperation(
          ctx,
          { id: opId, command: 'update_idea', input: normalized },
          async tx => {
            const outcome = await ideas.updateIdeaInTx(tx, {
              id: normalized.idea_id,
              recordRevision: normalized.record_revision,
              ...(normalized.title !== undefined ? { title: normalized.title } : {}),
              ...(normalized.details_markdown !== undefined ? { details_markdown: normalized.details_markdown } : {}),
              ...(normalized.needs !== undefined ? { needs: normalized.needs } : {}),
              ...(normalized.task_id !== undefined ? { taskId: normalized.task_id } : {}),
              ...(normalized.attachments !== undefined ? { appendAttachments: normalized.attachments } : {}),
            });
            freshWindowDoc = toWindowDocument(outcome.document);
            return updateIdeaData.parse({
              idea: outcome.idea,
              noop: outcome.noop,
            });
          },
          command.at,
          undefined,
          intent,
        );
        const saveData = updateIdeaData.parse(result.data);

        const existingReceipt = committedReceipts.get(opId);
        const reconstructed = reconstructWindowDocFromReceipt(saveData.idea, normalized, 'update_idea');
        const idea: IdeaWindowDocument | null =
          existingReceipt?.committedIdea ??
          freshWindowDoc ??
          reconstructed;
        if (!idea) {
          throw new Error('INVALID_COMMITTED_RECEIPT：操作已提交，但回执未携带完整详情快照');
        }
        if (!existingReceipt) {
          committedReceipts.set(opId, {
            operationId: opId,
            kind: 'save',
            fingerprint: fp,
            recordId: idea.id,
            committedIdea: idea,
          });
        }
        if (!result.replayed) {
          const snapRow = currentProjectedIdeas().find(r => r.id === idea.id);
          if (snapRow) lastBroadcastSig.set(idea.id, recordSignature(snapRow));
        }

        const seq = ++viewSeq;
        await safeReply(command.windowLabel, {
          kind: 'saved',
          requestId: command.requestId,
          mainEpoch: ctx.mainEpoch,
          viewSeq: seq,
          nextOperationId: crypto.randomUUID(),
          operationId: command.operationId ?? opId,
          replayed: result.replayed,
          idea,
        });
        if (!result.replayed) {
          await safeBroadcast({
            kind: 'updated',
            recordId: idea.id,
            mainEpoch: ctx.mainEpoch,
            viewSeq: seq,
            idea,
            viaWindowLabel: command.windowLabel,
          });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        let currentIdea: IdeaWindowDocument | null = null;
        try {
          currentIdea = toWindowDocument(await ideas.getIdeaDetails(ctx, command.recordId));
        } catch {
          currentIdea = committedReceipts.get(opId)?.committedIdea ?? null;
        }
        const isConflict =
          error instanceof ideas.RecordChangedError ||
          message.includes('RECORD_CHANGED') ||
          message.includes('OPERATION_CONFLICT') ||
          message.includes('版本已变化') ||
          message.includes('已变更') ||
          message.includes('冲突');
        const isNotFound = message.includes('找不到') || message.includes('不存在') || message.includes('IDEA_NOT_FOUND');
        await safeReply(command.windowLabel, {
          kind: 'error',
          requestId: command.requestId,
          mainEpoch: ctx.mainEpoch,
          code: isConflict ? 'CONFLICT' : isNotFound ? 'NOT_FOUND' : 'VALIDATION_ERROR',
          message,
          currentIdea,
        });
      }
      return;
    }

    if (command.kind === 'draft-create') {
      const opId = command.createOperationId.toLowerCase();
      const normalized = draftCreateNormalizedInput(command);
      const fp = canonicalJson(normalized);

      try {
        const existingReceipt = committedReceipts.get(opId);
        if (existingReceipt && existingReceipt.draftId && existingReceipt.draftId !== command.draftId) {
          throw new Error('OPERATION_CONFLICT：操作 ID 已用于不同草稿请求');
        }
        const intent: HistoryIntent = {
          action: 'idea.create',
          source: { kind: 'manual', via: command.windowLabel === 'quickbar' ? 'quickbar' : 'idea-window' },
        };
        let freshWindowDoc: IdeaWindowDocument | null = null;
        const result = await runOperation(
          ctx,
          { id: opId, command: 'create_idea', input: normalized },
          async tx => {
            const created = ideas.createIdeaInTx(tx, {
              title: normalized.title,
              details_markdown: normalized.details_markdown,
              needs: normalized.needs,
              taskId: normalized.task_id ?? null,
              attachments: normalized.attachments ?? [],
            });
            intent.subject = { type: 'record', id: created.record.id };
            freshWindowDoc = toWindowDocument(created.document);
            return createIdeaData.parse({ idea: created.idea });
          },
          command.at,
          undefined,
          intent,
        );
        const createData = createIdeaData.parse(result.data);

        const idea: IdeaWindowDocument | null =
          existingReceipt?.committedIdea ??
          freshWindowDoc ??
          reconstructWindowDocFromReceipt(createData.idea, normalized, 'create_idea');
        if (!idea) {
          throw new Error('INVALID_COMMITTED_RECEIPT：操作已提交，但回执未携带完整详情快照');
        }
        if (!existingReceipt) {
          committedReceipts.set(opId, {
            operationId: opId,
            kind: 'draft-create',
            fingerprint: fp,
            recordId: idea.id,
            draftId: command.draftId,
            draftVersion: command.draftVersion,
            committedIdea: idea,
          });
        }
        if (!result.replayed) {
          draftToRecordId.set(command.draftId, idea.id);
          pendingDraftHandoffs.delete(command.draftId);
          const snapRow = currentProjectedIdeas().find(r => r.id === idea.id);
          if (snapRow) lastBroadcastSig.set(idea.id, recordSignature(snapRow));
          await port.rebindDraftWindow(command.draftId, idea.id).catch(() => {});
        }

        const seq = ++viewSeq;
        await safeReply(command.windowLabel, {
          kind: 'draft-created',
          requestId: command.requestId,
          mainEpoch: ctx.mainEpoch,
          viewSeq: seq,
          nextOperationId: crypto.randomUUID(),
          operationId: command.createOperationId,
          replayed: result.replayed,
          draftId: command.draftId,
          draftVersion: command.draftVersion,
          idea,
        });
        if (!result.replayed) {
          await safeBroadcast({
            kind: 'created',
            recordId: idea.id,
            draftId: command.draftId,
            draftVersion: command.draftVersion,
            createOperationId: command.createOperationId,
            mainEpoch: ctx.mainEpoch,
            viewSeq: seq,
            idea,
            viaWindowLabel: command.windowLabel,
          });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const isConflict = message.includes('OPERATION_CONFLICT') || message.includes('冲突');
        let currentIdea: IdeaWindowDocument | null = committedReceipts.get(opId)?.committedIdea ?? null;
        if (isConflict) {
          try {
            const durable = await readOperation(ctx, opId);
            const dataObj = durable?.data as { idea?: IdeaSummaryDto } | undefined;
            const recId = committedReceipts.get(opId)?.recordId ?? dataObj?.idea?.id;
            if (recId) {
              try {
                currentIdea = toWindowDocument(await ideas.getIdeaDetails(ctx, recId));
              } catch {
                if (!currentIdea && dataObj?.idea && durable && (durable.command === 'create_idea' || durable.command === 'update_idea')) {
                  const parsedInput = JSON.parse(durable.input) as { details_markdown?: string; task_id?: string | null };
                  currentIdea = reconstructWindowDocFromReceipt(
                    dataObj.idea,
                    parsedInput,
                    durable.command,
                  );
                }
              }
            }
          } catch {
            // Keep existing currentIdea
          }
        }
        await safeReply(command.windowLabel, {
          kind: 'error',
          requestId: command.requestId,
          mainEpoch: ctx.mainEpoch,
          code: isConflict ? 'CONFLICT' : 'VALIDATION_ERROR',
          message: isConflict
            ? '该草稿已由另一窗口创建，当前内容与已创建版本不同，请基于最新版本继续保存'
            : message,
          currentIdea,
        });
      }
    }
  };

  const offCommands = port.subscribeCommands(cmd => {
    if (disposed) return;
    void handleCommand(cmd).catch(err => onError?.(err));
  });

  const offHandoff = port.subscribeDraftHandoff(event => {
    if (disposed) return;
    const parsed = ideaDraftHandoffSnapshotSchema.safeParse(event.snapshot);
    if (parsed.success) {
      pendingDraftHandoffs.set(event.draftId, parsed.data);
    }
  });

  // Watch store updates to broadcast external mutations (drawer, MCP, CLI, QuickBar reconcile)
  const unsubscribeStore = appStore.subscribe(() => {
    if (disposed) return;
    const currentRecords = currentProjectedIdeas();
    const seenIds = new Set<string>();

    for (const r of currentRecords) {
      seenIds.add(r.id);
      const sig = recordSignature(r);
      const prevSig = lastBroadcastSig.get(r.id);
      if (prevSig === undefined) {
        lastBroadcastSig.set(r.id, sig);
        continue;
      }
      if (prevSig !== sig) {
        lastBroadcastSig.set(r.id, sig);
        void ideas.getIdeaDetails(ctx, r.id).then(doc => {
          if (disposed) return;
          const kind: IdeaWindowCommittedEvent['kind'] =
            doc.pool === '已完成' ? 'completed' : doc.pool === '已转任务' ? 'converted' : 'updated';
          return safeBroadcast({
            kind,
            recordId: doc.id,
            mainEpoch: ctx.mainEpoch,
            viewSeq: ++viewSeq,
            idea: toWindowDocument(doc),
            viaWindowLabel: 'main',
          });
        }).catch(() => {});
      }
    }

    for (const oldId of [...lastBroadcastSig.keys()]) {
      if (!seenIds.has(oldId)) {
        lastBroadcastSig.delete(oldId);
        void safeBroadcast({
          kind: 'deleted',
          recordId: oldId,
          mainEpoch: ctx.mainEpoch,
          viewSeq: ++viewSeq,
          idea: null,
          viaWindowLabel: 'main',
        });
      }
    }
  });

  return {
    async openIdeaWindow(recordId, title, initialDraft) {
      if (initialDraft) {
        pendingInitialDrafts.set(recordId, initialDraft);
      }
      await port.openIdeaWindow(recordId, title);
    },
    async openIdeaDraftWindow(snapshot) {
      pendingDraftHandoffs.set(snapshot.draftId, snapshot);
      await port.openIdeaDraftWindow({
        draftId: snapshot.draftId,
        draftVersion: snapshot.draftVersion,
        createOperationId: snapshot.createOperationId,
        title: snapshot.title,
        snapshot,
      });
    },
    dispose() {
      disposed = true;
      unsubscribeStore();
      void offCommands.then(fn => fn()).catch(() => {});
      void offHandoff.then(fn => fn()).catch(() => {});
    },
  };
}

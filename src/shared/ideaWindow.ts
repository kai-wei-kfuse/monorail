import { z } from 'zod';

const poolSchema = z.enum(['活跃池', '冷库', '已转任务', '已完成']);
const completedBySchema = z.object({
  kind: z.enum(['manual', 'mcp', 'cli', 'automation']),
  agent: z.string().nullable(),
});

export const ideaWindowDocumentSchema = z.object({
  id: z.string().min(1),
  text: z.string(),
  detailsMarkdown: z.string(),
  tags: z.array(z.string()),
  needs: z.string().nullable(),
  attachments: z.array(z.string()).optional(),
  pool: poolSchema.nullable(),
  createdAt: z.string(),
  lastTouchedAt: z.string().nullable(),
  completedAt: z.string().nullable().optional(),
  completedBy: completedBySchema.nullable().optional(),
  recordRevision: z.string().min(1),
  taskId: z.string().nullable().optional(),
});
export type IdeaWindowDocument = z.infer<typeof ideaWindowDocumentSchema>;

export const ideaDraftHandoffSnapshotSchema = z.object({
  draftId: z.string().min(1),
  draftVersion: z.number().int().nonnegative(),
  createOperationId: z.string().min(1),
  title: z.string(),
  detailsMarkdown: z.string(),
  needs: z.string().nullable(),
  taskId: z.string().nullable(),
  attachments: z.array(z.string()),
  createdAt: z.string(),
});
export type IdeaDraftHandoffSnapshot = z.infer<typeof ideaDraftHandoffSnapshotSchema>;

export const ideaInitialEditDraftSchema = z.object({
  title: z.string(),
  detailsMarkdown: z.string(),
  needs: z.string().nullable(),
  baseRevision: z.string().min(1),
  editMode: z.boolean(),
});
export type IdeaInitialEditDraft = z.infer<typeof ideaInitialEditDraftSchema>;

export type QuickBarDraftState = 'local' | 'saving' | 'handoff' | 'create_pending' | 'committed';

export const ideaWindowCommandSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('load'),
    requestId: z.string().min(1),
    recordId: z.string().min(1),
    windowLabel: z.string().min(1),
    windowSession: z.string().min(1),
    mainEpoch: z.number().int().nonnegative(),
  }),
  z.object({
    kind: z.literal('save'),
    requestId: z.string().min(1),
    recordId: z.string().min(1),
    windowLabel: z.string().min(1),
    windowSession: z.string().min(1),
    mainEpoch: z.number().int().nonnegative(),
    operationId: z.string().min(1).optional(),
    baseRevision: z.string().min(1),
    text: z.string(),
    detailsMarkdown: z.string(),
    needs: z.string().nullable(),
    taskId: z.string().nullable().optional(),
    attachments: z.array(z.string()).optional(),
    at: z.string(),
  }),
  z.object({
    kind: z.literal('draft-load'),
    requestId: z.string().min(1),
    draftId: z.string().min(1),
    windowLabel: z.string().min(1),
    windowSession: z.string().min(1),
    mainEpoch: z.number().int().nonnegative(),
  }),
  z.object({
    kind: z.literal('draft-create'),
    requestId: z.string().min(1),
    draftId: z.string().min(1),
    draftVersion: z.number().int().nonnegative(),
    createOperationId: z.string().min(1),
    windowLabel: z.string().min(1),
    windowSession: z.string().min(1),
    mainEpoch: z.number().int().nonnegative(),
    text: z.string(),
    detailsMarkdown: z.string(),
    needs: z.string().nullable(),
    taskId: z.string().nullable(),
    attachments: z.array(z.string()),
    at: z.string(),
  }),
  z.object({
    kind: z.literal('query-receipt'),
    requestId: z.string().min(1),
    operationId: z.string().min(1),
    windowLabel: z.string().min(1),
    windowSession: z.string().min(1),
    mainEpoch: z.number().int().nonnegative(),
  }),
]);
export type IdeaWindowCommand = z.infer<typeof ideaWindowCommandSchema>;

export const ideaWindowReplySchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('loaded'),
    requestId: z.string().min(1),
    mainEpoch: z.number().int().nonnegative(),
    viewSeq: z.number().int().nonnegative(),
    nextOperationId: z.string().min(1),
    idea: ideaWindowDocumentSchema,
    initialDraft: ideaInitialEditDraftSchema.nullable().optional(),
  }),
  z.object({
    kind: z.literal('saved'),
    requestId: z.string().min(1),
    mainEpoch: z.number().int().nonnegative(),
    viewSeq: z.number().int().nonnegative(),
    nextOperationId: z.string().min(1),
    operationId: z.string().min(1),
    replayed: z.boolean(),
    idea: ideaWindowDocumentSchema,
  }),
  z.object({
    kind: z.literal('draft-loaded'),
    requestId: z.string().min(1),
    mainEpoch: z.number().int().nonnegative(),
    viewSeq: z.number().int().nonnegative(),
    nextOperationId: z.string().min(1),
    draft: ideaDraftHandoffSnapshotSchema,
  }),
  z.object({
    kind: z.literal('draft-created'),
    requestId: z.string().min(1),
    mainEpoch: z.number().int().nonnegative(),
    viewSeq: z.number().int().nonnegative(),
    nextOperationId: z.string().min(1),
    operationId: z.string().min(1),
    replayed: z.boolean(),
    draftId: z.string().min(1),
    draftVersion: z.number().int().nonnegative(),
    idea: ideaWindowDocumentSchema,
  }),
  z.object({
    kind: z.literal('receipt'),
    requestId: z.string().min(1),
    mainEpoch: z.number().int().nonnegative(),
    operationId: z.string().min(1),
    status: z.enum(['committed', 'not_found', 'unknown']),
    idea: ideaWindowDocumentSchema.nullable().optional(),
    message: z.string().nullable().optional(),
  }),
  z.object({
    kind: z.literal('error'),
    requestId: z.string().min(1),
    mainEpoch: z.number().int().nonnegative(),
    code: z.enum(['CONFLICT', 'NOT_FOUND', 'EPOCH_MISMATCH', 'VALIDATION_ERROR', 'INTERNAL']),
    message: z.string(),
    currentIdea: ideaWindowDocumentSchema.nullable().optional(),
  }),
]);
export type IdeaWindowReply = z.infer<typeof ideaWindowReplySchema>;

export const ideaWindowCommittedEventSchema = z.object({
  kind: z.enum(['created', 'updated', 'completed', 'uncompleted', 'converted', 'deleted']),
  recordId: z.string().min(1),
  draftId: z.string().nullable().optional(),
  draftVersion: z.number().int().nonnegative().nullable().optional(),
  createOperationId: z.string().nullable().optional(),
  mainEpoch: z.number().int().nonnegative(),
  viewSeq: z.number().int().nonnegative(),
  idea: ideaWindowDocumentSchema.nullable().optional(),
  viaWindowLabel: z.string().nullable().optional(),
});
export type IdeaWindowCommittedEvent = z.infer<typeof ideaWindowCommittedEventSchema>;

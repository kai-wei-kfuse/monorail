// Frozen 0.3.0 format/semantics (tag v0.3.0, 23d6240) for ADR 0021 compatibility locks; never edit.
import { z } from 'zod';
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const change = z.strictObject({ type: z.enum(['entry', 'card', 'task', 'record', 'review', 'settings', 'state']), id: z.string(), name: z.string(),
  field: z.string(), before: z.string().nullable(), after: z.string().nullable() });
const agent = z.strictObject({ name: z.string().nullable(), raw: z.string().optional(), version: z.string().optional(),
  detected_by: z.enum(['mcp_handshake', 'env', 'flag', 'none']), evidence: z.string().optional() });
const source = z.union([
  z.strictObject({ kind: z.literal('manual'), via: z.enum(['main', 'mini', 'quickbar']), page: z.string().optional() }),
  z.strictObject({ kind: z.literal('system'), trigger: z.enum(['dayChange', 'resume', 'reconcile']) }),
  z.strictObject({ kind: z.enum(['mcp', 'cli', 'automation']), agent }),
]);
export const historyRecordSchema = z.strictObject({
  version: z.literal(1), id: z.string().regex(/^[A-Za-z0-9-]+$/), at: z.iso.datetime({ offset: true }), day,
  action: z.string().min(1), label: z.string(), source, why: z.string().optional(),
  subject: z.strictObject({ type: change.shape.type, id: z.string(), text: z.string(), meta: z.string() }).nullable(),
  changes: z.array(change), effects: z.array(change),
  merged: z.number().int().min(2).optional(), reverted: z.boolean().optional(),
  call: z.strictObject({ method: z.string(), operation_id: z.string(), params: z.string(), truncated: z.boolean() }).optional(),
});

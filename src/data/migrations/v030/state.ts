// Frozen 0.3.0 format/semantics (tag v0.3.0, 23d6240) for ADR 0021 compatibility locks; never edit.
import { z } from 'zod';
export const currentStateSchema = z.object({
  schemaVersion: z.literal(2), current_card: z.string().nullable(),
  open_entry: z.string().nullable(), seen: z.array(z.string()),
  open_entry_day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  resume_entry_id: z.string().nullable(), pending_at: z.iso.datetime({ offset: true }).nullable(), pending_id: z.string().nullable(),
  home_mode: z.enum(['blank', 'task', 'guide', 'rest', 'review']),
  first_used_day: z.iso.date().nullable(), review_period: z.string().nullable(),
  refusals: z.array(z.iso.datetime({ offset: true })), last_rest_ended_at: z.iso.datetime({ offset: true }).nullable(),
  rest_answers: z.record(z.string(), z.number().int().nonnegative()),
  rest: z.object({ suggestion: z.string().nullable(), started_at: z.iso.datetime({ offset: true }) }).nullable(),
});
export const stateSchema = currentStateSchema.refine(state => (state.pending_at === null) === (state.pending_id === null), '待确认起点与标识必须同时存在');
export type AppState = z.infer<typeof stateSchema>;

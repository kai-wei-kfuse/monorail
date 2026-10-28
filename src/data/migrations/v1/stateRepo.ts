// Frozen 0.1.4 format/semantics for the one-way v2 migration.
import { parse, stringify } from 'yaml';
import { z } from 'zod';
import type { FileSystem } from '../../fs';
import type { Write } from '../../journal';
import { createWrite } from '../../journal';

const currentStateSchema = z.object({
  schemaVersion: z.literal(1),
  max_seq: z.number().int().nonnegative(), current_card: z.string().nullable(),
  open_segment: z.string().nullable(), seen: z.array(z.string()), stopped_day: z.string().nullable(),
  // Optional only for the original skeleton format; startup resolves and persists it.
  open_segment_day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  home_mode: z.enum(['task', 'guide', 'rest', 'review', 'stopped']),
  first_used_day: z.iso.date().nullable(), review_period: z.string().nullable(),
  refusals: z.array(z.iso.datetime({ offset: true })), last_rest_ended_at: z.iso.datetime({ offset: true }).nullable(),
  rest_answers: z.record(z.string(), z.number().int().nonnegative()),
  rest: z.object({ suggestion: z.string().nullable(), started_at: z.iso.datetime({ offset: true }) }).nullable(),
});
export const stateSchema = z.preprocess(value => {
  if (value && typeof value === 'object' && !Array.isArray(value) && !('schemaVersion' in value)) {
    // M0 had no degradation/review state; migrate only that known older format.
    return { schemaVersion: 1, home_mode: 'guide', first_used_day: null, review_period: null,
      refusals: [], last_rest_ended_at: null, rest_answers: {}, rest: null, ...value };
  }
  return value;
}, currentStateSchema);
export type AppState = z.infer<typeof stateSchema>;
export const initialState: AppState = { schemaVersion: 1, max_seq: 0, current_card: null, open_segment: null, open_segment_day: null, seen: [], stopped_day: null,
  home_mode: 'guide', first_used_day: null, review_period: null, refusals: [], last_rest_ended_at: null, rest_answers: {}, rest: null };
export class StateRepo {
  constructor(private fs: FileSystem) {}
  async read(): Promise<AppState> {
    const file = await this.fs.read('state.yaml');
    if (!file) return structuredClone(initialState);
    try { return stateSchema.parse(parse(file.text)); }
    catch (error) { throw new Error('state.yaml: invalid state', { cause: error }); }
  }
  async write(state: AppState): Promise<Write> {
    return createWrite('state.yaml', stringify(stateSchema.parse(state)), (await this.fs.read('state.yaml'))?.text ?? null);
  }
}

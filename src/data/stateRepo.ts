import { parse, stringify } from 'yaml';
import { z } from 'zod';
import type { FileSystem } from './fs';
import type { Write } from './journal';
import { createWrite } from './journal';

const currentStateSchema = z.object({
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
export const initialState: AppState = { schemaVersion: 2, current_card: null, open_entry: null, open_entry_day: null, seen: [],
  resume_entry_id: null, pending_at: null, pending_id: null,
  home_mode: 'blank', first_used_day: null, review_period: null, refusals: [], last_rest_ended_at: null, rest_answers: {}, rest: null };
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

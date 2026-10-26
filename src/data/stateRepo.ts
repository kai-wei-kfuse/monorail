import { parse, stringify } from 'yaml';
import { z } from 'zod';
import type { FileSystem } from './fs';
import type { Write } from './journal';
import { createWrite } from './journal';

export const stateSchema = z.object({
  max_seq: z.number().int().nonnegative(), current_card: z.string().nullable(),
  open_segment: z.string().nullable(), seen: z.array(z.string()), stopped_day: z.string().nullable(),
  // Optional only for the original skeleton format; startup resolves and persists it.
  open_segment_day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
});
export type AppState = z.infer<typeof stateSchema>;
export const initialState: AppState = { max_seq: 0, current_card: null, open_segment: null, open_segment_day: null, seen: [], stopped_day: null };
export class StateRepo {
  constructor(private fs: FileSystem) {}
  async read(): Promise<AppState> {
    const file = await this.fs.read('state.yaml');
    if (!file) return { ...initialState, seen: [] };
    try { return stateSchema.parse(parse(file.text)); }
    catch (error) { throw new Error('state.yaml: invalid state', { cause: error }); }
  }
  async write(state: AppState): Promise<Write> {
    return createWrite('state.yaml', stringify(stateSchema.parse(state)), (await this.fs.read('state.yaml'))?.text ?? null);
  }
}

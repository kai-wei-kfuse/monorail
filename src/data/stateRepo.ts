import { parse, stringify } from 'yaml';
import { z } from 'zod';
import type { FileSystem } from './fs';
import type { Write } from './journal';

export const stateSchema = z.object({
  max_seq: z.number().int().nonnegative(), current_card: z.string().nullable(),
  open_segment: z.string().nullable(), seen: z.array(z.string()), stopped_day: z.string().nullable(),
});
export type AppState = z.infer<typeof stateSchema>;
export const initialState: AppState = { max_seq: 0, current_card: null, open_segment: null, seen: [], stopped_day: null };
export class StateRepo {
  constructor(private fs: FileSystem) {}
  async read(): Promise<AppState> {
    const file = await this.fs.read('state.yaml');
    return file ? stateSchema.parse(parse(file.text)) : { ...initialState, seen: [] };
  }
  async write(state: AppState): Promise<Write> {
    return { path: 'state.yaml', text: stringify(stateSchema.parse(state)), before: (await this.fs.read('state.yaml'))?.text ?? null };
  }
}

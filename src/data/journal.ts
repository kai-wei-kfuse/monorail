import { z } from 'zod';
import type { FileSystem } from './fs';
import { safeRelative } from './fs';

declare const writeToken: unique symbol;
/** Only data repositories construct writes; consumers cannot inspect or assemble paths. */
export interface Write { readonly [writeToken]: true }
const planSchema = z.object({ id: z.uuid(), writes: z.array(z.object({ path: z.string(), text: z.string(), before: z.string().nullable() })) });
type WriteContent = z.infer<typeof planSchema>['writes'][number];
/** Data-layer commit observers only; never expose contents on the service interface. */
export function committedWrite(write: Write): WriteContent { return write as unknown as WriteContent; }
export function createWrite(path: string, text: string, before: string | null): Write {
  safeRelative(path);
  return { path, text, before } as unknown as Write;
}

export class Journal {
  constructor(private fs: FileSystem) {}
  private async apply(writes: WriteContent[]) {
    for (const write of writes) {
      safeRelative(write.path);
      const actual = (await this.fs.read(write.path))?.text ?? null;
      if (actual === write.text) continue;
      if (actual !== write.before) throw new Error(`Recovery conflict: ${write.path}`);
      await this.fs.atomicWrite(write.path, write.text);
    }
  }
  async run(id: string, writes: Write[]): Promise<void> {
    const plan = planSchema.parse({ id, writes });
    if (new Set(plan.writes.map(w => w.path)).size !== writes.length) throw new Error('Duplicate path in transaction');
    for (const write of plan.writes) {
      safeRelative(write.path);
      if (((await this.fs.read(write.path))?.text ?? null) !== write.before) throw new Error(`External edit: ${write.path}`);
    }
    const path = `.journal/${id}.json`;
    await this.fs.atomicWrite(path, JSON.stringify(plan));
    await this.apply(plan.writes);
    await this.fs.remove(path);
  }
  async recover(): Promise<number> {
    const paths = (await this.fs.list('.journal')).filter(p => p.endsWith('.json'));
    for (const path of paths) {
      const file = await this.fs.read(path);
      if (!file) throw new Error(`Journal disappeared: ${path}`);
      const plan = planSchema.parse(JSON.parse(file.text));
      await this.apply(plan.writes);
      await this.fs.remove(path);
    }
    return paths.length;
  }
}

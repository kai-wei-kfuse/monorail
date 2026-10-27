import type { z } from 'zod';
import type { FileSystem } from './fs';
import type { Write } from './journal';
import { createWrite } from './journal';
import { decode, encode } from './frontmatter';

export interface Entity<T> { value: T; body: string; text: string; version: string }
export class MdRepo<T extends { id: string }> {
  constructor(private fs: FileSystem, private directory: string, private schema: z.ZodType<T>) {}
  path(id: string) {
    if (!/^[a-zA-Z0-9-]+$/.test(id)) throw new Error('Invalid entity ID');
    return `${this.directory}/${id}.md`;
  }
  async get(id: string): Promise<Entity<T> | null> {
    const path = this.path(id), file = await this.fs.read(path);
    if (!file) return null;
    const parsed = decode(file.text, path);
    try { return { value: this.schema.parse(parsed.meta), body: parsed.body, ...file }; }
    catch (error) { throw new Error(`${path}: invalid entity`, { cause: error }); }
  }
  async list(): Promise<Entity<T>[]> {
    const result = [];
    for (const path of (await this.fs.list(this.directory)).filter(p => p.endsWith('.md'))) {
      const id = path.slice(this.directory.length + 1, -3), entity = await this.get(id);
      if (!entity) throw new Error(`Entity disappeared: ${path}`);
      result.push(entity);
    }
    return result;
  }
  async write(value: T, original: Entity<T> | null, body = original?.body ?? ''): Promise<Write> {
    const path = this.path(value.id), current = await this.fs.read(path);
    if ((current?.version ?? null) !== (original?.version ?? null)) throw new Error(`External edit (mtime): ${path}`);
    const meta = { ...(original ? decode(original.text, path).meta : {}), ...value };
    try { this.schema.parse(meta); }
    catch (error) { throw new Error(`${path}: invalid entity`, { cause: error }); }
    return createWrite(path, encode(meta, body), original?.text ?? null);
  }
  async remove(original: Entity<T>): Promise<Write> {
    const path = this.path(original.value.id), current = await this.fs.read(path);
    if (current?.version !== original.version) throw new Error(`External edit (mtime): ${path}`);
    return createWrite(path, null, original.text);
  }
}

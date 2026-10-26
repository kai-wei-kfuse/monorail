import type { FileSnapshot, FileSystem } from './fs';
import { safeRelative } from './fs';

export class MemoryFs implements FileSystem {
  private files = new Map<string, FileSnapshot>();
  private revision = 0;
  beforeWrite?: (path: string) => void;
  async read(path: string): Promise<FileSnapshot | null> { return this.files.get(safeRelative(path)) ?? null; }
  async list(directory: string): Promise<string[]> { return [...this.files.keys()].filter(p => p.startsWith(`${directory}/`)).sort(); }
  async atomicWrite(path: string, text: string): Promise<void> {
    safeRelative(path);
    this.beforeWrite?.(path);
    this.files.set(path, { text, version: String(++this.revision) });
  }
  async remove(path: string): Promise<void> {
    if (!this.files.delete(safeRelative(path))) throw new Error(`File missing: ${path}`);
  }
}

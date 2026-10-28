export interface FileSnapshot { text: string; version: string }
export interface FileSystem {
  read(path: string): Promise<FileSnapshot | null>;
  list(directory: string, recursive?: boolean): Promise<string[]>;
  atomicWrite(path: string, text: string): Promise<void>;
  remove(path: string): Promise<void>;
}

export function safeRelative(path: string): string {
  if (!path || path.startsWith('/') || path.includes('\\') || path.includes(':') || path.split('/').some(p => p === '..' || p === '.')) {
    throw new Error(`Unsafe relative path: ${path}`);
  }
  return path;
}

export async function tauriFs(root: string): Promise<FileSystem> {
  const fs = await import('@tauri-apps/plugin-fs');
  const { join, dirname } = await import('@tauri-apps/api/path');
  const resolve = (path: string) => join(root, safeRelative(path));
  return {
    async read(path) {
      const full = await resolve(path);
      if (!await fs.exists(full)) return null;
      const info = await fs.stat(full);
      return { text: await fs.readTextFile(full), version: `${info.mtime?.getTime()}:${info.size}` };
    },
    async list(directory, recursive = false) {
      const full = directory ? await resolve(directory) : root;
      if (!await fs.exists(full)) return [];
      const collect = async (relative: string, absolute: string): Promise<string[]> => {
        const result: string[] = [];
        for (const entry of await fs.readDir(absolute)) {
          const name = relative ? `${relative}/${entry.name}` : entry.name;
          if (entry.isFile) result.push(name);
          else if (recursive && entry.isDirectory) result.push(...await collect(name, await join(absolute, entry.name)));
        }
        return result;
      };
      return (await collect(directory, full)).sort();
    },
    async atomicWrite(path, text) {
      const full = await resolve(path);
      await fs.mkdir(await dirname(full), { recursive: true });
      const temp = `${full}.tmp-${crypto.randomUUID()}`;
      await fs.writeTextFile(temp, text);
      await fs.rename(temp, full);
    },
    async remove(path) { await fs.remove(await resolve(path)); },
  };
}

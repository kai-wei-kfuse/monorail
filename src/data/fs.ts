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

interface RootSplit { root: string; rest: string; sep: '/' | '\\' }

/** Configured data directories are absolute, as required by save_config. Keep volume roots intact. */
function splitRoot(path: string): RootSplit {
  const sep = path.includes('\\') ? '\\' : '/';
  let match: RegExpExecArray | null;
  if ((match = /^([\\/]{2}[?.][\\/]UNC[\\/][^\\/]+[\\/][^\\/]+)(?:[\\/](.*))?$/i.exec(path))) {
    return { root: match[1].replace(/[\\/]/g, sep), rest: match[2] ?? '', sep };
  }
  if ((match = /^([\\/]{2}[?.][\\/][A-Za-z]:[\\/])(.*)$/.exec(path))) {
    return { root: match[1].replace(/[\\/]/g, sep), rest: match[2], sep };
  }
  // Extended volume paths need their namespace prefix even when they have no drive letter.
  if ((match = /^([\\/]{2}[?.][\\/][^\\/]+[\\/])(.*)$/.exec(path))) {
    return { root: match[1].replace(/[\\/]/g, sep), rest: match[2], sep };
  }
  if ((match = /^([\\/]{2}(?![?.][\\/])[^\\/]+[\\/][^\\/]+)(?:[\\/](.*))?$/.exec(path))) {
    return { root: match[1].replace(/[\\/]/g, sep), rest: match[2] ?? '', sep };
  }
  if ((match = /^([A-Za-z]:[\\/])(.*)$/.exec(path))) {
    return { root: match[1].replace(/[\\/]/g, sep), rest: match[2], sep };
  }
  if ((match = /^\/+(.*)$/.exec(path))) return { root: '/', rest: match[1], sep: '/' };
  throw new Error(`Data directory must be absolute: ${path}`);
}

function buildPath({ root, sep }: RootSplit, segments: string[]): string {
  if (!segments.length) return root;
  return `${root}${root.endsWith(sep) ? '' : sep}${segments.join(sep)}`;
}

export function resolveLocal(base: string, relative: string): string {
  safeRelative(relative);
  const parts = splitRoot(base);
  return buildPath(parts, [...parts.rest.split(/[\\/]+/).filter(Boolean), ...relative.split('/').filter(Boolean)]);
}

export function parentLocal(path: string): string {
  const parts = splitRoot(path), segments = parts.rest.split(/[\\/]+/).filter(Boolean);
  segments.pop();
  return buildPath(parts, segments);
}

export async function tauriFs(root: string): Promise<FileSystem> {
  const fs = await import('@tauri-apps/plugin-fs');
  splitRoot(root);
  const resolve = (path: string) => resolveLocal(root, path);
  return {
    async read(path) {
      const full = resolve(path);
      if (!await fs.exists(full)) return null;
      const [info, text] = await Promise.all([fs.stat(full), fs.readTextFile(full)]);
      return { text, version: `${info.mtime?.getTime()}:${info.size}` };
    },
    async list(directory, recursive = false) {
      const full = directory ? resolve(directory) : root;
      if (!await fs.exists(full)) return [];
      const collect = async (relative: string, absolute: string): Promise<string[]> => {
        const result: string[] = [];
        for (const entry of await fs.readDir(absolute)) {
          const name = relative ? `${relative}/${entry.name}` : entry.name;
          if (entry.isFile) result.push(name);
          else if (recursive && entry.isDirectory) result.push(...await collect(name, resolveLocal(absolute, entry.name)));
        }
        return result;
      };
      return (await collect(directory, full)).sort();
    },
    async atomicWrite(path, text) {
      const full = resolve(path);
      await fs.mkdir(parentLocal(full), { recursive: true });
      const temp = `${full}.tmp-${crypto.randomUUID()}`;
      await fs.writeTextFile(temp, text);
      await fs.rename(temp, full);
    },
    async remove(path) { await fs.remove(resolve(path)); },
  };
}

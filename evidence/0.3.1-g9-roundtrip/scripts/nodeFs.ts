// G9 第 5 项往返测试用：Node 版 FileSystem，语义照抄 src/data/fs.ts 的 tauriFs（version = mtime:size，list 返回相对根目录的路径，
// atomicWrite = 写临时文件再 rename）。只在临时数据目录上用，不碰用户数据。三个版本（0.3.1 / 0.3.0 / 0.2.5）的 FileSystem 接口相同。
import { promises as fsp, existsSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, join, relative, sep } from 'node:path';

export interface FileSnapshot { text: string; version: string }
const bad = (path: string) => !path || path.startsWith('/') || path.includes('\\') || path.includes(':') || path.split('/').some(p => p === '..' || p === '.');

export class NodeFs {
  writes: string[] = [];
  removes: string[] = [];
  constructor(private root: string) {
    if (!/monorail-rt-data/i.test(root)) throw new Error(`拒绝：数据目录不在测试临时目录下 ${root}`);
  }
  private resolve(path: string) { if (bad(path)) throw new Error(`Unsafe relative path: ${path}`); return join(this.root, ...path.split('/')); }
  async read(path: string): Promise<FileSnapshot | null> {
    const full = this.resolve(path);
    if (!existsSync(full)) return null;
    const [info, text] = await Promise.all([fsp.stat(full), fsp.readFile(full, 'utf8')]);
    return { text, version: `${info.mtime.getTime()}:${info.size}` };
  }
  async list(directory: string, recursive = false): Promise<string[]> {
    const full = directory ? this.resolve(directory) : this.root;
    if (!existsSync(full)) return [];
    const collect = async (rel: string, abs: string): Promise<string[]> => {
      const out: string[] = [];
      for (const entry of await fsp.readdir(abs, { withFileTypes: true })) {
        const name = rel ? `${rel}/${entry.name}` : entry.name;
        if (entry.isFile()) out.push(name);
        else if (recursive && entry.isDirectory()) out.push(...await collect(name, join(abs, entry.name)));
      }
      return out;
    };
    return (await collect(directory, full)).sort();
  }
  async atomicWrite(path: string, text: string): Promise<void> {
    const full = this.resolve(path);
    await fsp.mkdir(dirname(full), { recursive: true });
    const temp = `${full}.tmp-${randomUUID()}`;
    await fsp.writeFile(temp, text, 'utf8');
    await fsp.rename(temp, full);
    this.writes.push(path);
  }
  async remove(path: string): Promise<void> { await fsp.rm(this.resolve(path)); this.removes.push(path); }
}

/** 整个数据目录的清单：相对路径 → sha256（前 16 位）和大小。 */
export async function manifest(root: string): Promise<Record<string, { sha: string; size: number }>> {
  const out: Record<string, { sha: string; size: number }> = {};
  const walk = async (abs: string) => {
    if (!existsSync(abs)) return;
    for (const entry of await fsp.readdir(abs, { withFileTypes: true })) {
      const p = join(abs, entry.name);
      if (entry.isDirectory()) await walk(p);
      else {
        const buf = await fsp.readFile(p);
        out[relative(root, p).split(sep).join('/')] = { sha: createHash('sha256').update(buf).digest('hex').slice(0, 16), size: buf.length };
      }
    }
  };
  await walk(root);
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}

export async function writeJson(path: string, value: unknown) {
  await fsp.mkdir(dirname(path), { recursive: true });
  await fsp.writeFile(path, JSON.stringify(value, null, 2), 'utf8');
}
export const readJson = async <T>(path: string): Promise<T> => JSON.parse(await fsp.readFile(path, 'utf8')) as T;
export const readText = (root: string, rel: string) => fsp.readFile(join(root, ...rel.split('/')), 'utf8');
export const fileExists = (root: string, rel: string) => existsSync(join(root, ...rel.split('/')));

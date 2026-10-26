import { it, expect } from 'vitest';
import { MemoryFs } from './memoryFs';
import { Journal, createWrite } from './journal';
import * as nodefs from 'node:fs/promises';
import * as path from 'node:path';
import type { FileSystem } from './fs';

it('replays a failed multi-file write exactly once after a simulated process restart', async () => {
  const fs = new MemoryFs();
  await fs.atomicWrite('a.md', 'old-a'); await fs.atomicWrite('b.md', 'old-b');
  fs.beforeWrite = path => { if (path === 'b.md') throw new Error('injected process failure'); };
  await expect(new Journal(fs).run(crypto.randomUUID(), [createWrite('a.md', 'new-a', 'old-a'), createWrite('b.md', 'new-b', 'old-b')])).rejects.toThrow('injected');
  expect((await fs.read('a.md'))?.text).toBe('new-a'); expect((await fs.read('b.md'))?.text).toBe('old-b');
  fs.beforeWrite = undefined;
  expect(await new Journal(fs).recover()).toBe(1);
  expect((await fs.read('b.md'))?.text).toBe('new-b');
  expect(await new Journal(fs).recover()).toBe(0);
});
it('rejects conflicts during recovery', async () => {
  const fs = new MemoryFs(); fs.beforeWrite = path => { if (path === 'b') throw new Error('injected'); };
  await expect(new Journal(fs).run(crypto.randomUUID(), [createWrite('a', 'A', null), createWrite('b', 'B', null)])).rejects.toThrow();
  fs.beforeWrite = undefined; await fs.atomicWrite('b', 'external');
  await expect(new Journal(fs).recover()).rejects.toThrow('Recovery conflict');
});

it('replays interrupted writes on a real filesystem using fresh journal objects', async () => {
  const base = path.resolve('.verification-data'); await nodefs.mkdir(base, { recursive: true });
  const root = await nodefs.mkdtemp(path.join(base, 'journal-'));
  const real: FileSystem = {
    async read(name) {
      try { const full = path.join(root, name), stat = await nodefs.stat(full); return { text: await nodefs.readFile(full, 'utf8'), version: `${stat.mtimeMs}:${stat.size}` }; }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
    },
    async list(dir) { try { return (await nodefs.readdir(path.join(root, dir))).map(n => `${dir}/${n}`); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; } },
    async atomicWrite(name, text) { const full = path.join(root, name); await nodefs.mkdir(path.dirname(full), { recursive: true }); await nodefs.writeFile(`${full}.tmp`, text); await nodefs.rename(`${full}.tmp`, full); },
    async remove(name) { await nodefs.unlink(path.join(root, name)); },
  };
  const failing: FileSystem = { ...real, async atomicWrite(name, text) { if (name === 'b.md') throw new Error('injected disk write failure'); await real.atomicWrite(name, text); } };
  await expect(new Journal(failing).run(crypto.randomUUID(), [createWrite('a.md', 'A', null), createWrite('b.md', 'B', null)])).rejects.toThrow('injected');
  const replayed = await new Journal(real).recover();
  expect(replayed).toBe(1); expect((await real.read('a.md'))?.text).toBe('A'); expect((await real.read('b.md'))?.text).toBe('B');
  await nodefs.mkdir('evidence', { recursive: true });
  await nodefs.writeFile('evidence/journal-real.json', JSON.stringify({ root, replayed, remainingJournals: await real.list('.journal'), result: 'passed', at: new Date().toISOString() }, null, 2));
});

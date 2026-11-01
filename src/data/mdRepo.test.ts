import { expect, it, vi } from 'vitest';
import { z } from 'zod';
import { MemoryFs } from './memoryFs';
import { MdRepo } from './mdRepo';
import { Journal } from './journal';
import { recordSchema } from './schemas';
import { encode, decode } from './frontmatter';
import { createRecord } from '../domain/record/record';
import type { RecordEntry } from '../domain/record/record';

const record = () => createRecord({ id: crypto.randomUUID(), text: '原文 #test', kind: '想法', created_at: '2026-10-27T00:00:00Z', due_at: null, blocking: false, task_id: null, card_id: null, tags: [], attachments: [] });
it('keeps unknown fields and original body when updating an entity', async () => {
  const fs = new MemoryFs(), repo = new MdRepo<RecordEntry>(fs, 'records', recordSchema), value = record();
  const path = repo.path(value.id);
  await fs.atomicWrite(path, encode({ ...value, future: { enabled: true } }, '长正文\n---\n末尾'));
  const original = (await repo.get(value.id))!;
  await new Journal(fs).run(crypto.randomUUID(), [await repo.write({ ...original.value, text: '新标题' }, original)]);
  const saved = decode((await fs.read(path))!.text, path);
  expect(saved.meta).toMatchObject({ text: '新标题', future: { enabled: true } }); expect(saved.body).toBe(original.body);
});
it('rejects changed mtime even if the external writer used identical contents', async () => {
  const fs = new MemoryFs(), repo = new MdRepo<RecordEntry>(fs, 'records', recordSchema), value = record();
  await fs.atomicWrite(repo.path(value.id), encode(value, ''));
  const original = (await repo.get(value.id))!;
  await fs.atomicWrite(repo.path(value.id), original.text);
  await expect(repo.write(value, original)).rejects.toThrow('External edit (mtime)');
});
it('includes file paths for schema failures during reads and writes', async () => {
  const fs = new MemoryFs(), repo = new MdRepo<RecordEntry>(fs, 'records', recordSchema), value = record(), path = repo.path(value.id);
  await fs.atomicWrite(path, encode({ ...value, kind: 'unknown' }, ''));
  await expect(repo.get(value.id)).rejects.toThrow(path);
  await fs.remove(path);
  await expect(repo.write({ ...value, created_at: 'invalid' }, null)).rejects.toThrow(path);
});
it('does not overwrite a file when creation expected it to be absent', async () => {
  const fs = new MemoryFs(), repo = new MdRepo<RecordEntry>(fs, 'records', recordSchema), value = record();
  await fs.atomicWrite(repo.path(value.id), encode(value, 'existing'));
  await expect(repo.write(value, null)).rejects.toThrow('External edit');
});

function cachedFixture() {
  const fs = new MemoryFs();
  let parses = 0;
  const schema = z.object({ id: z.string(), nested: z.object({ values: z.array(z.string()) }) }).passthrough()
    .transform(value => { parses++; return value; });
  const repo = new MdRepo(fs, 'records', schema);
  const value = { id: 'cached', nested: { values: ['original'] }, future: { flags: [true] } };
  return { fs, repo, value, path: repo.path(value.id), parses: () => parses };
}

it('reads disk on every cache hit and isolates both first returns and hits, including unknown nested fields', async () => {
  const f = cachedFixture();
  await f.fs.atomicWrite(f.path, encode(f.value, 'body'));
  const read = vi.spyOn(f.fs, 'read');
  const first = (await f.repo.get(f.value.id))!;
  first.value.nested.values.push('mutated');
  (first.value.future as { flags: boolean[] }).flags[0] = false;
  first.body = 'mutated body';
  const second = (await f.repo.get(f.value.id))!;
  expect(second.value).toEqual(f.value);
  expect(second.body).toBe('body');
  second.value.nested.values.push('another mutation');
  expect((await f.repo.get(f.value.id))!.value).toEqual(f.value);
  expect(read).toHaveBeenCalledTimes(3);
  expect(f.parses()).toBe(1);
});

it('reparses same-version changed text and lets Journal reject the old snapshot before overwriting', async () => {
  const f = cachedFixture();
  await f.fs.atomicWrite(f.path, encode(f.value, 'body'));
  const original = (await f.repo.get(f.value.id))!;
  const changed = encode({ ...f.value, nested: { values: ['external'] } }, 'changed body');
  (await f.fs.read(f.path))!.text = changed; // External writer preserving mtime and size token.
  expect((await f.repo.get(f.value.id))!.value.nested.values).toEqual(['external']);
  expect(f.parses()).toBe(2);
  const write = await f.repo.write(original.value, original);
  await expect(new Journal(f.fs).run(crypto.randomUUID(), [write])).rejects.toThrow('External edit');
  expect((await f.fs.read(f.path))!.text).toBe(changed);
});

it('reparses unchanged text with a changed version and preserves mtime rejection', async () => {
  const f = cachedFixture();
  await f.fs.atomicWrite(f.path, encode(f.value, 'body'));
  const original = (await f.repo.get(f.value.id))!;
  await f.fs.atomicWrite(f.path, original.text);
  expect((await f.repo.get(f.value.id))!.version).not.toBe(original.version);
  expect(f.parses()).toBe(2);
  await expect(f.repo.write(original.value, original)).rejects.toThrow('External edit (mtime)');
});

it('never falls back to a cached value after deletion, malformed data or an IO error', async () => {
  const f = cachedFixture();
  await f.fs.atomicWrite(f.path, encode(f.value, 'body'));
  await f.repo.get(f.value.id);
  await f.fs.remove(f.path);
  expect(await f.repo.get(f.value.id)).toBeNull();
  await f.fs.atomicWrite(f.path, 'invalid frontmatter');
  await expect(f.repo.get(f.value.id)).rejects.toThrow(f.path);
  await f.fs.atomicWrite(f.path, encode({ ...f.value, nested: 'invalid' }, ''));
  await expect(f.repo.get(f.value.id)).rejects.toThrow('invalid entity');
  (await f.fs.read(f.path))!.text = encode(f.value, 'repaired');
  expect((await f.repo.get(f.value.id))!.body).toBe('repaired');
  const error = new Error('permission denied');
  vi.spyOn(f.fs, 'read').mockRejectedValueOnce(error);
  await expect(f.repo.get(f.value.id)).rejects.toBe(error);
  expect((await f.repo.get(f.value.id))!.value).toEqual(f.value);
});

it('starts list reads together, preserves listed order and discards deleted cache entries', async () => {
  const f = cachedFixture(), ids = ['a', 'b', 'c'];
  for (const id of ids) await f.fs.atomicWrite(f.repo.path(id), encode({ ...f.value, id }, ''));
  const snapshots = await Promise.all(ids.map(id => f.fs.read(f.repo.path(id))));
  const pending: Array<() => void> = [];
  let completed = false;
  const read = vi.spyOn(f.fs, 'read').mockImplementation(path => new Promise((resolve, reject) => {
    pending.push(() => resolve(snapshots[ids.findIndex(id => f.repo.path(id) === path)]));
    queueMicrotask(() => {
      if (pending.length !== ids.length) { reject(new Error('list reads were serialized')); return; }
      if (completed) return;
      completed = true;
      for (const finish of [...pending].reverse()) finish();
    });
  }));
  expect((await f.repo.list()).map(entity => entity.value.id)).toEqual(ids);
  read.mockRestore();
  await f.fs.remove(f.repo.path('b'));
  expect((await f.repo.list()).map(entity => entity.value.id)).toEqual(['a', 'c']);
  await f.fs.atomicWrite(f.repo.path('b'), snapshots[1]!.text);
  (await f.fs.read(f.repo.path('b')))!.version = snapshots[1]!.version;
  expect((await f.repo.list()).map(entity => entity.value.id)).toEqual(ids);
  expect(f.parses()).toBe(4);
});

it('rejects an enumerated entity that disappears without returning a partial list', async () => {
  const f = cachedFixture();
  await f.fs.atomicWrite(f.path, encode(f.value, ''));
  await f.repo.get(f.value.id);
  vi.spyOn(f.fs, 'read').mockResolvedValueOnce(null);
  await expect(f.repo.list()).rejects.toThrow(`Entity disappeared: ${f.path}`);
});

it('does not cache planned writes/removals or a journal write that failed before reaching the entity', async () => {
  const f = cachedFixture();
  await f.fs.atomicWrite(f.path, encode(f.value, 'body'));
  const original = (await f.repo.get(f.value.id))!;
  const write = await f.repo.write({ ...original.value, nested: { values: ['planned'] } }, original);
  await f.repo.remove(original);
  expect((await f.repo.get(f.value.id))!.value).toEqual(f.value);
  f.fs.beforeWrite = path => { if (path === f.path) throw new Error('disk write failed'); };
  await expect(new Journal(f.fs).run(crypto.randomUUID(), [write])).rejects.toThrow('disk write failed');
  expect((await f.repo.get(f.value.id))!.value).toEqual(f.value);
});

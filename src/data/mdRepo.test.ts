import { expect, it } from 'vitest';
import { MemoryFs } from './memoryFs';
import { MdRepo } from './mdRepo';
import { Journal } from './journal';
import { recordSchema } from './schemas';
import { encode, decode } from './frontmatter';

const record = () => ({ id: crypto.randomUUID(), text: '原文', kind: '想法' as const, created_at: '2026-10-27T00:00:00Z', due_at: null, blocking: false, project_id: null, card_id: null, tags: ['test'], attachments: [] });
it('keeps unknown fields and original body when updating an entity', async () => {
  const fs = new MemoryFs(), repo = new MdRepo(fs, 'records', recordSchema), value = record();
  const path = repo.path(value.id);
  await fs.atomicWrite(path, encode({ ...value, future: { enabled: true } }, '长正文\n---\n末尾'));
  const original = (await repo.get(value.id))!;
  await new Journal(fs).run(crypto.randomUUID(), [await repo.write({ ...original.value, text: '新标题' }, original)]);
  const saved = decode((await fs.read(path))!.text, path);
  expect(saved.meta).toMatchObject({ text: '新标题', future: { enabled: true } }); expect(saved.body).toBe(original.body);
});
it('rejects changed mtime even if the external writer used identical contents', async () => {
  const fs = new MemoryFs(), repo = new MdRepo(fs, 'records', recordSchema), value = record();
  await fs.atomicWrite(repo.path(value.id), encode(value, ''));
  const original = (await repo.get(value.id))!;
  await fs.atomicWrite(repo.path(value.id), original.text);
  await expect(repo.write(value, original)).rejects.toThrow('External edit (mtime)');
});
it('includes file paths for schema failures during reads and writes', async () => {
  const fs = new MemoryFs(), repo = new MdRepo(fs, 'records', recordSchema), value = record(), path = repo.path(value.id);
  await fs.atomicWrite(path, encode({ ...value, kind: 'unknown' }, ''));
  await expect(repo.get(value.id)).rejects.toThrow(path);
  await fs.remove(path);
  await expect(repo.write({ ...value, created_at: 'invalid' }, null)).rejects.toThrow(path);
});
it('does not overwrite a file when creation expected it to be absent', async () => {
  const fs = new MemoryFs(), repo = new MdRepo(fs, 'records', recordSchema), value = record();
  await fs.atomicWrite(repo.path(value.id), encode(value, 'existing'));
  await expect(repo.write(value, null)).rejects.toThrow('External edit');
});

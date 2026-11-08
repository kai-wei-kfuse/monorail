import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { stringify } from 'yaml';
import { MemoryFs } from '../src/data/memoryFs';
import { encode } from '../src/data/frontmatter';
import { committedWrite } from '../src/data/journal';
import { migrateV2 } from '../src/data/migrations/v2';
import { MdRepo } from '../src/data/mdRepo';
import { recordSchema } from '../src/data/schemas';
import { createRecord } from '../src/domain/record/record';

const id = '00000000-0000-4000-8000-0000000000a1';
const created = '2026-10-27T00:00:00.000Z';
const record = (text: string) => createRecord({
  id, text, kind: '想法', created_at: created, due_at: null, blocking: false,
  task_id: null, card_id: null, tags: [], attachments: [],
});

async function hashes(fs: MemoryFs): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const path of await fs.list('')) {
    const file = await fs.read(path);
    out[path] = createHash('sha256').update(file?.text ?? '').digest('hex');
  }
  return out;
}

async function seed(schemaVersion: number): Promise<MemoryFs> {
  const fs = new MemoryFs();
  const meta = record('标题');
  await fs.atomicWrite('state.yaml', stringify({ schemaVersion }));
  await fs.atomicWrite('records/same.md', encode(meta, '标题'));
  await fs.atomicWrite('records/empty.md', encode({ ...meta, id: '00000000-0000-4000-8000-0000000000a2' }, ''));
  await fs.atomicWrite('records/diff.md', encode({ ...meta, id: '00000000-0000-4000-8000-0000000000a3' }, '详情\n---\n第二段'));
  await fs.atomicWrite('records/multi.md', encode({ ...meta, id: '00000000-0000-4000-8000-0000000000a4', text: '第一行\n第二行' }, '另一段正文'));
  await fs.atomicWrite('timelog/2026-10-27.md', '[]\n');
  return fs;
}

it('schema 3 is rejected before any write and leaves every file hash unchanged', async () => {
  const fs = await seed(3);
  const writes: string[] = [];
  fs.beforeWrite = path => writes.push(path);
  const before = await hashes(fs);
  await expect(migrateV2(fs, { now: created, id: () => '00000000-0000-4000-8000-0000000000b1' })).rejects.toThrow('state.yaml: invalid state');
  expect(writes).toEqual([]);
  expect(await hashes(fs)).toEqual(before);
  expect(await fs.list('backup')).toEqual([]);
  console.log(JSON.stringify({ case: 'schema3-no-journal', hashes: before }));
});

it('an unfinished journal is applied before the schema 3 rejection', async () => {
  const fs = await seed(3);
  const original = (await fs.read('records/diff.md'))!.text;
  const rewritten = original.replace('详情\n---\n第二段', '被旧版 journal 先写掉');
  await fs.atomicWrite('.journal/00000000-0000-4000-8000-0000000000c1.json', JSON.stringify({
    id: '00000000-0000-4000-8000-0000000000c1',
    writes: [{ path: 'records/diff.md', text: rewritten, before: original }],
  }));
  const writes: string[] = [];
  fs.beforeWrite = path => writes.push(path);
  const beforeRecord = (await fs.read('records/diff.md'))!.text;
  await expect(migrateV2(fs, { now: created, id: () => '00000000-0000-4000-8000-0000000000b2' })).rejects.toThrow('state.yaml: invalid state');
  expect(writes).toEqual(['records/diff.md']);
  expect((await fs.read('records/diff.md'))!.text).toBe(rewritten);
  expect((await fs.read('records/diff.md'))!.text).not.toBe(beforeRecord);
  expect(await fs.read('.journal/00000000-0000-4000-8000-0000000000c1.json')).toBeNull();
  expect(await fs.list('backup')).toEqual([]);
  console.log(JSON.stringify({
    case: 'schema3-journal-first',
    recordChanged: true,
    before: createHash('sha256').update(beforeRecord).digest('hex'),
    after: createHash('sha256').update((await fs.read('records/diff.md'))!.text).digest('hex'),
  }));
});

it('schema 2 returns without rewriting the four body shapes', async () => {
  const fs = await seed(2);
  const before = await hashes(fs);
  const result = await migrateV2(fs, { now: created, id: () => '00000000-0000-4000-8000-0000000000b3' });
  expect(result).toEqual({ migrated: false, backup: null, changes: [] });
  expect(await hashes(fs)).toEqual(before);
});

it('the current record write keeps a different body until text changes', async () => {
  const fs = new MemoryFs();
  const repo = new MdRepo(fs, 'records', recordSchema);
  const value = record('标题');
  await fs.atomicWrite(`records/${id}.md`, encode(value, '详情\n---\n第二段'));
  const original = (await repo.get(id))!;
  const kept = committedWrite(await repo.write({ ...value, needs: '时间' }, original, value.text !== original.value.text ? value.text : undefined));
  expect(kept.text).toContain('详情\n---\n第二段');
  const edited = record('新标题');
  const replaced = committedWrite(await repo.write(edited, original, edited.text !== original.value.text ? edited.text : undefined));
  expect(replaced.text).toContain('新标题');
  expect(replaced.text).not.toContain('详情');
});

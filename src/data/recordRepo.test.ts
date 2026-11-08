import { expect, it } from 'vitest';
import { MemoryFs } from './memoryFs';
import { encode, splitRecordFrontmatter } from './frontmatter';
import { committedWrite } from './journal';
import { RecordRepo } from './recordRepo';
import { recordSchema } from './schemas';
import { compareAll } from '../domain/history/compare';
import { sha256Hex } from '../shared/sha256';
import type { RecordEntry } from '../domain/record/record';

const recId = '00000000-0000-4000-8000-000000000010';

const baseRecord: RecordEntry = {
  id: recId,
  text: '初始标题 #笔记',
  kind: '想法',
  created_at: '2026-11-08T08:00:00.000Z',
  due_at: null,
  blocking: false,
  task_id: null,
  card_id: null,
  tags: ['笔记'],
  attachments: [],
  needs: '安静下午',
  pool: '活跃池',
  last_touched_at: '2026-11-08T08:00:00.000Z',
  cold_since: null,
};

it('RecordRepo: list/get return summary without holding body, while getDetails returns normalized and raw body', async () => {
  const fs = new MemoryFs();
  const crlfBody = '第一行详情\r\n第二行详情\r\n\r\n';
  await fs.atomicWrite(`records/${recId}.md`, `---\n${encode(baseRecord, '').split('---\n')[1]}---\r\n${crlfBody}`);

  const repo = new RecordRepo(fs, 'records', recordSchema);
  const list = await repo.list();
  expect(list).toHaveLength(1);
  const summary = list[0];
  expect(summary.hasDetails).toBe(true);
  expect(summary.recordRevision).toMatch(/^ir3:[0-9a-f]{64}$/);
  expect('body' in summary).toBe(false);
  expect('text' in summary).toBe(false);

  const details = await repo.getDetails(recId);
  expect(details).not.toBeNull();
  expect(details!.rawBody).toBe(crlfBody);
  expect(details!.body).toBe('第一行详情\n第二行详情\n\n');
  expect(details!.recordRevision).toBe(summary.recordRevision);
});

it('D2: metadata-only updates and semantically identical detail saves preserve rawBody CRLF and trailing newlines byte-for-byte', async () => {
  const fs = new MemoryFs();
  const crlfBody = '保留原始CRLF第一行\r\n保留第二行\r\n末尾空行\r\n\r\n';
  const initialFile = `---\nid: ${recId}\ntext: 初始标题 #笔记\nkind: 想法\ncreated_at: 2026-11-08T08:00:00.000Z\ndue_at: null\nblocking: false\ntask_id: null\ncard_id: null\ntags:\n  - 笔记\nattachments: []\nneeds: 安静下午\npool: 活跃池\nlast_touched_at: 2026-11-08T08:00:00.000Z\ncold_since: null\n---\r\n${crlfBody}`;
  await fs.atomicWrite(`records/${recId}.md`, initialFile);

  const repo = new RecordRepo(fs, 'records', recordSchema);
  const entities = await repo.list();

  // 1. Metadata-only change (title + needs): omit details -> rawBody bytes after frontmatter must stay identical!
  const prep1 = await repo.prepareWrite({ ...baseRecord, text: '修改后的标题 #笔记', needs: '整块时间' }, entities[0]);
  const w1 = committedWrite(prep1.write);
  await fs.atomicWrite(w1.path, w1.text!);

  const after1 = (await fs.read(`records/${recId}.md`))!.text;
  const split1 = splitRecordFrontmatter(after1, `records/${recId}.md`);
  expect(split1.meta.text).toBe('修改后的标题 #笔记');
  expect(split1.meta.needs).toBe('整块时间');
  expect(split1.rawBody).toBe(crlfBody);

  // 2. Explicit details patch whose normalized N(details) equals N(rawBody) -> preserves rawBody!
  const entities2 = await repo.list();
  const prep2 = await repo.prepareWrite(
    { ...baseRecord, text: '再次改标题 #笔记', needs: '整块时间' },
    entities2[0],
    '保留原始CRLF第一行\n保留第二行\n末尾空行\n\n',
  );
  const w2 = committedWrite(prep2.write);
  await fs.atomicWrite(w2.path, w2.text!);

  const after2 = (await fs.read(`records/${recId}.md`))!.text;
  const split2 = splitRecordFrontmatter(after2, `records/${recId}.md`);
  expect(split2.rawBody).toBe(crlfBody);

  // 3. Actual details change -> writes normalized LF body
  const entities3 = await repo.list();
  const prep3 = await repo.prepareWrite(
    { ...baseRecord, text: '再次改标题 #笔记', needs: '整块时间' },
    entities3[0],
    '全新正文第一行\r\n全新第二行',
  );
  const w3 = committedWrite(prep3.write);
  await fs.atomicWrite(w3.path, w3.text!);

  const after3 = (await fs.read(`records/${recId}.md`))!.text;
  const split3 = splitRecordFrontmatter(after3, `records/${recId}.md`);
  expect(split3.rawBody).toBe('全新正文第一行\n全新第二行');
});

it('D2: detects external file modification even when only line endings or same-length bytes changed after baseline read', async () => {
  const fs = new MemoryFs();
  await fs.atomicWrite(`records/${recId}.md`, encode(baseRecord, '原始正文ABC'));

  const repo = new RecordRepo(fs, 'records', recordSchema);
  const entities = await repo.list();

  // External process modifies body to same-length '原始正文ABD' before prepareWrite()
  await fs.atomicWrite(`records/${recId}.md`, encode(baseRecord, '原始正文ABD'));

  await expect(repo.prepareWrite({ ...baseRecord, needs: '新需要' }, entities[0])).rejects.toThrow(`External edit`);
});

it('ADR 0026: details-only change with identical first 60 chars still produces history change via details_digest without storing body', () => {
  const prefix60 = '这是一段超过六十个字符的完全相同的开头内容，用于验证当想法详情仅在后半段发生变化时，历史对比依然能够通过摘要哈希准确捕获变化！';
  const bodyBefore = `${prefix60}\n- 第一版尾部条目`;
  const bodyAfter = `${prefix60}\n- 第二版尾部条目`;

  const diff = compareAll({
    cards: [],
    tasks: [],
    reviews: [],
    records: [
      {
        id: recId,
        before: baseRecord,
        after: baseRecord,
        beforeDetailsDigest: sha256Hex(bodyBefore),
        afterDetailsDigest: sha256Hex(bodyAfter),
      },
    ],
    entries: { before: [], after: [] },
    state: { before: {}, after: {} },
    settings: { before: {}, after: {} },
    names: { tasks: new Map(), cards: new Map(), entries: new Map() },
  });
  expect(diff).toEqual([
    {
      type: 'record',
      id: recId,
      name: '初始标题 #笔记',
      field: '详情',
      before: '有详情',
      after: '已更新',
    },
  ]);
});

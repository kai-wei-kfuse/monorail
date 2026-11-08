import { expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { MemoryFs } from '../memoryFs';
import { encode, splitRecordFrontmatter } from '../frontmatter';
import { migrateAll, migrateV3 } from './v3';
import { initialState, StateRepo } from '../stateRepo';
import { defaults as v3Defaults } from '../../shared/settings';
import { mapLegacyIdeaContent } from '../../domain/record/record';

const at = (minute: number) => new Date(Date.UTC(2026, 10, 8, 0, minute)).toISOString();
const id1 = '00000000-0000-4000-8000-000000000001';
const id2 = '00000000-0000-4000-8000-000000000002';
const id3 = '00000000-0000-4000-8000-000000000003';
const id4 = '00000000-0000-4000-8000-000000000004';
const id5 = '00000000-0000-4000-8000-000000000005';
const idTodo = '00000000-0000-4000-8000-000000000006';

function makeIdeaMeta(id: string, text: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    text,
    kind: '想法' as const,
    created_at: at(0),
    due_at: null,
    blocking: false,
    task_id: null,
    card_id: null,
    tags: ['原标签'],
    attachments: [] as string[],
    needs: null,
    pool: '活跃池' as const,
    last_touched_at: at(0),
    cold_since: null,
    ...extra,
  };
}

async function v2Fixture(mainTasks: 1 | 2 | 3 = 1) {
  const fs = new MemoryFs();
  await fs.atomicWrite('state.yaml', stringify({ ...initialState, schemaVersion: 2, custom_state_key: 'keep-state' }));
  await fs.atomicWrite(
    'settings.yaml',
    stringify({ ...v3Defaults, schemaVersion: 2, mainTasks, custom_settings_key: 'keep-settings' }),
  );
  // 1. Single-line T and B = T -> title = T, details = ''
  await fs.atomicWrite(`records/${id1}.md`, encode(makeIdeaMeta(id1, '单行想法 #标签'), '单行想法 #标签'));
  // 2. Multi-line T and B = T -> title = A, details = R (retaining first LF)
  await fs.atomicWrite(
    `records/${id2}.md`,
    encode(makeIdeaMeta(id2, '看视频\n稍后看 https://example.com/a\n#服务器'), '看视频\n稍后看 https://example.com/a\n#服务器'),
  );
  // 3. B is empty -> title = A, details = R
  await fs.atomicWrite(`records/${id3}.md`, encode(makeIdeaMeta(id3, '仅YAML多行\n第二行'), ''));
  // 4. B starts with T at full line boundary -> title = A, details = R + B.slice(T.length)
  await fs.atomicWrite(
    `records/${id4}.md`,
    encode(makeIdeaMeta(id4, '首行标题\n已有次行'), '首行标题\n已有次行\n外部追加段落'),
  );
  // 5. B non-empty and not prefix of T -> title = A, details = R ? R + '\n\n' + B : B
  await fs.atomicWrite(`records/${id5}.md`, encode(makeIdeaMeta(id5, '独立标题\n副标题'), '完全不同的正文内容'));
  // 6. Todo record -> kept as legacy format untouched
  await fs.atomicWrite(
    `records/${idTodo}.md`,
    encode(
      {
        ...makeIdeaMeta(idTodo, '待办第一行\n待办第二行'),
        kind: '待办',
        pool: null,
      },
      '待办第一行\n待办第二行',
    ),
  );
  await fs.atomicWrite(`attachments/${id1}/shot.png`, 'png-bytes');
  return fs;
}

it('ADR 0026: mapLegacyIdeaContent satisfies all 6 branches, line-boundary checks, CRLF normalization, and blank rejection', () => {
  expect(mapLegacyIdeaContent('单行标题', '单行标题', [])).toEqual({ title: '单行标题', details: '' });
  expect(mapLegacyIdeaContent('看视频\r\n稍后看', '看视频\n稍后看', [])).toEqual({
    title: '看视频',
    details: '\n稍后看',
  });
  expect(mapLegacyIdeaContent('首行\n次行', '', [])).toEqual({ title: '首行', details: '\n次行' });
  expect(mapLegacyIdeaContent('标题', '标题\n补充正文', [])).toEqual({
    title: '标题',
    details: '\n补充正文',
  });
  expect(mapLegacyIdeaContent('标题', '标题补充', [])).toEqual({
    title: '标题',
    details: '标题补充',
  });
  expect(mapLegacyIdeaContent('标题', '独立正文', [])).toEqual({
    title: '标题',
    details: '独立正文',
  });
  expect(mapLegacyIdeaContent('标题\n次行', '独立正文', [])).toEqual({
    title: '标题',
    details: '\n次行\n\n独立正文',
  });
  expect(mapLegacyIdeaContent('\n资料', '\n资料', [])).toEqual({
    title: '',
    details: '\n资料',
  });
  expect(mapLegacyIdeaContent('标题\n', '标题\n', [])).toEqual({
    title: '标题',
    details: '\n',
  });
  expect(mapLegacyIdeaContent('', '只有正文', [])).toEqual({
    title: '',
    details: '只有正文',
  });
  expect(mapLegacyIdeaContent('', '', ['attachments/r/a.png'])).toEqual({
    title: '',
    details: '',
  });
  expect(() => mapLegacyIdeaContent('   ', ' \r\n ', [], 'records/bad.md')).toThrow('records/bad.md');
});

it('migrates v2 -> v3 once, upgrades mainTasks 1 -> 2 while preserving 2/3, backs up byte-identically, and keeps todo records untouched', async () => {
  const fs = await v2Fixture(1);
  const originals = new Map<string, string>();
  for (const dir of ['', 'records', 'attachments/r']) {
    for (const p of await fs.list(dir)) {
      const f = await fs.read(p);
      if (f) originals.set(p, f.text);
    }
  }

  const res = await migrateV3(fs, { now: at(10), id: () => crypto.randomUUID() });
  expect(res.migrated).toBe(true);
  expect(res.backup).toBeTruthy();

  for (const [path, text] of originals) {
    if (path.startsWith('attachments/')) continue;
    expect((await fs.read(`${res.backup}/${path}`))?.text).toBe(text);
  }

  const state = parse((await fs.read('state.yaml'))!.text);
  expect(state.schemaVersion).toBe(3);
  expect(state.custom_state_key).toBe('keep-state');

  const settings = parse((await fs.read('settings.yaml'))!.text);
  expect(settings.schemaVersion).toBe(3);
  expect(settings.mainTasks).toBe(2);
  expect(settings.custom_settings_key).toBe('keep-settings');

  const r1 = splitRecordFrontmatter((await fs.read(`records/${id1}.md`))!.text, `records/${id1}.md`);
  expect(r1.meta.text).toBe('单行想法 #标签');
  expect(r1.normalizedBody).toBe('');
  expect(r1.meta.tags).toEqual(['原标签']);

  const r2 = splitRecordFrontmatter((await fs.read(`records/${id2}.md`))!.text, `records/${id2}.md`);
  expect(r2.meta.text).toBe('看视频');
  expect(r2.normalizedBody).toBe('\n稍后看 https://example.com/a\n#服务器');

  const r3 = splitRecordFrontmatter((await fs.read(`records/${id3}.md`))!.text, `records/${id3}.md`);
  expect(r3.meta.text).toBe('仅YAML多行');
  expect(r3.normalizedBody).toBe('\n第二行');

  const r4 = splitRecordFrontmatter((await fs.read(`records/${id4}.md`))!.text, `records/${id4}.md`);
  expect(r4.meta.text).toBe('首行标题');
  expect(r4.normalizedBody).toBe('\n已有次行\n外部追加段落');

  const r5 = splitRecordFrontmatter((await fs.read(`records/${id5}.md`))!.text, `records/${id5}.md`);
  expect(r5.meta.text).toBe('独立标题');
  expect(r5.normalizedBody).toBe('\n副标题\n\n完全不同的正文内容');

  expect((await fs.read(`records/${idTodo}.md`))!.text).toBe(originals.get(`records/${idTodo}.md`));

  expect((await migrateV3(fs, { now: at(11), id: () => crypto.randomUUID() })).migrated).toBe(false);

  const fs3 = await v2Fixture(3);
  await migrateV3(fs3, { now: at(12), id: () => crypto.randomUUID() });
  expect(parse((await fs3.read('settings.yaml'))!.text).mainTasks).toBe(3);
});

it('recovers after every write boundary with state.yaml as the first journal item and no mixed-state corruption', async () => {
  const probe = await v2Fixture(1);
  let totalWrites = 0;
  probe.beforeWrite = () => { totalWrites++; };
  await migrateV3(probe, { now: at(20), id: () => crypto.randomUUID() });
  expect(totalWrites).toBeGreaterThan(5);

  for (let failAt = 1; failAt <= totalWrites; failAt++) {
    const fs = await v2Fixture(1);
    let writes = 0;
    fs.beforeWrite = () => {
      if (++writes === failAt) throw new Error(`interrupted at ${failAt}`);
    };
    await expect(migrateV3(fs, { now: at(20), id: () => crypto.randomUUID() })).rejects.toThrow(`interrupted at ${failAt}`);
    fs.beforeWrite = undefined;

    await migrateAll(fs, { now: at(21), id: () => crypto.randomUUID() });
    expect((await new StateRepo(fs).read()).schemaVersion).toBe(3);
    expect((await fs.list('.journal')).length).toBe(0);
    const r2 = splitRecordFrontmatter((await fs.read(`records/${id2}.md`))!.text, `records/${id2}.md`);
    expect(r2.meta.text).toBe('看视频');
    expect(r2.normalizedBody).toBe('\n稍后看 https://example.com/a\n#服务器');
  }
});

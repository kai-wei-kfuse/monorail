import { expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { createRepos } from './repos';
import { MemoryFs } from './memoryFs';
import { decode, encode } from './frontmatter';
import { defaults } from '../shared/settings';
import { createCard } from '../domain/card/edit';
import { toV1, taskReferenceFields } from './v1Codec';

const at = (minute = 0) => new Date(2026, 9, 27, 10, minute).toISOString();

it('round-trips v1 task references and task directories without introducing v2 disk keys', async () => {
  const fs = new MemoryFs(), repos = createRepos(fs);
  const memoryCard = createCard('card', { content: 'card', type: '结果卡', timeboxMinutes: null,
    dueAt: null, blocking: false, noShrink: false, taskId: 'work' }, at(), 1);
  const { task_id: taskId, ...fields } = memoryCard;
  await fs.atomicWrite('cards/card.md', encode({ ...fields, project_id: taskId, custom: 'keep' }, 'original body'));
  await fs.atomicWrite('projects/work.md', encode({ id: 'work', name: 'work', slot: '主线', slot_index: 1,
    status: '进行中', created_at: at(), bet_ends_at: null }, 'task body'));
  const loaded = (await repos.cards.get('card'))!;
  expect(loaded.value).toMatchObject({ task_id: 'work', custom: 'keep' });
  expect(loaded.value).not.toHaveProperty('project_id');
  const loadedTask = (await repos.tasks.get('work'))!;
  await repos.transact(crypto.randomUUID(), [
    await repos.cards.write({ ...loaded.value, content: 'renamed' }, loaded),
    await repos.tasks.write({ ...loadedTask.value, name: 'renamed task' }, loadedTask),
  ]);
  const saved = decode((await fs.read('cards/card.md'))!.text, 'cards/card.md');
  expect(saved.meta).toMatchObject({ project_id: 'work', custom: 'keep', content: 'renamed' });
  expect(saved.meta).not.toHaveProperty('task_id');
  expect(saved.body).toBe('original body');
  expect(await fs.list('tasks')).toEqual([]);
  expect(decode((await fs.read('projects/work.md'))!.text, 'projects/work.md').meta.name).toBe('renamed task');
});

it('preserves record and review disk fields, including the quickbar serialization path', async () => {
  const fs = new MemoryFs(), repos = createRepos(fs), id = crypto.randomUUID();
  const record = { id, text: 'note', kind: '待办', created_at: at(), due_at: null, blocking: false,
    project_id: 'work', card_id: null, tags: [], attachments: [] };
  await fs.atomicWrite(`records/${id}.md`, encode(record, 'note'));
  await fs.atomicWrite('reviews/2026-W44.md', encode({ id: '2026-W44', period: '2026-W44', status: '未开始', step: 'recap', bet_project_ids: ['work'] }, ''));
  const loaded = (await repos.records.get(id))!, review = (await repos.reviews.get('2026-W44'))!;
  expect(loaded.value.task_id).toBe('work');
  expect(review.value.bet_task_ids).toEqual(['work']);
  await repos.transact(crypto.randomUUID(), [await repos.records.write(loaded.value, loaded), await repos.reviews.write(review.value, review)]);
  expect(decode((await fs.read(`records/${id}.md`))!.text, id).meta).toMatchObject({ project_id: 'work' });
  const meta = decode((await fs.read('reviews/2026-W44.md'))!.text, 'review').meta;
  expect(meta.bet_project_ids).toEqual(['work']); expect(meta).not.toHaveProperty('bet_task_ids');
  expect(toV1(loaded.value, taskReferenceFields)).toMatchObject({ project_id: 'work' });
  expect(toV1(loaded.value, taskReferenceFields)).not.toHaveProperty('task_id');
});

it('reads and writes the v1 category field for both time logs and quick activity settings', async () => {
  const fs = new MemoryFs(), repos = createRepos(fs), id = crypto.randomUUID(), day = '2026-10-27';
  await fs.atomicWrite(`timelog/${day}.md`, stringify([{ id, seq: 1, started_at: at(), ended_at: null,
    activity: 'work', category: '学习', card_id: null, kind: '普通', source: '手动', resume_card_id: null }]));
  await fs.atomicWrite('settings.yaml', stringify({ ...defaults, lists: { ...defaults.lists,
    quickActivities: [{ id: 'walk', name: 'walk', category: '生活', custom: true }] } }));
  const [segment] = await repos.times.readDay(day), settings = await repos.settings.read();
  expect(segment.project).toBe('学习'); expect(segment).not.toHaveProperty('category');
  expect(settings.lists.quickActivities[0].project).toBe('生活');
  await repos.transact(crypto.randomUUID(), [
    ...await repos.times.writes([{ day, segment: { ...segment, ended_at: at(5) } }]),
    await repos.settings.write(settings),
  ]);
  const diskSegment = parse((await fs.read(`timelog/${day}.md`))!.text)[0];
  expect(diskSegment.category).toBe('学习'); expect(diskSegment).not.toHaveProperty('project');
  const diskSettings = parse((await fs.read('settings.yaml'))!.text);
  expect(diskSettings.schemaVersion).toBe(1);
  expect(diskSettings.lists.quickActivities[0]).toEqual({ id: 'walk', name: 'walk', category: '生活', custom: true });
});

import { expect, it } from 'vitest';
import { fixture, at, seed, entries, open } from './serviceFixture';
import { beginPending, startFree, pause, insert, manual, overlaps, startPreset } from './homeService';
import { addFavorite, favorite, editFavorite, removeFavorite, reorderFavorites, createProject } from './presetService';

const value = { description: '学习', project: '学习', tags: ['课'] };
it('projects the persisted return target even after a more recent insertion ends', async () => {
  const f = fixture(); await seed(f, []); expect(f.home().resumeDescription).toBeNull();
  await startFree(f.ctx, value, at()); f.clock(at(10)); await insert(f.ctx, 'wc', at(10));
  f.clock(at(20)); await pause(f.ctx, at(20)); expect(f.home().resumeDescription).toBe('学习');
});
it('manual entries coexist and overlap queries clip precisely without publishing or writing', async () => {
  const f = fixture(); await startFree(f.ctx, value, at()); const running = open(f);
  f.clock(at(60)); const id = await manual(f.ctx, { ...value, description: '网课' }, at(20), at(40), at(60));
  expect(open(f)).toEqual(running); expect(entries(f).find(row => row.id === id)).toMatchObject({ card_id: null, source: '手动' });
  const calls = f.publish.mock.calls.length, before = entries(f);
  expect(overlaps(f.ctx, at(30), at(50))).toEqual(expect.arrayContaining([
    expect.objectContaining({ id, from: at(30), to: at(40) }),
    expect.objectContaining({ id: running.id, from: at(30), to: at(50) }),
  ]));
  expect(f.publish).toHaveBeenCalledTimes(calls); expect(entries(f)).toEqual(before);
  await expect(manual(f.ctx, value, at(50), at(61), at(60))).rejects.toThrow('现在');
  expect(() => overlaps(f.ctx, 'bad', at(60))).toThrow('范围');
});
it('creates unique project colors serially and rejects reserved/existing names', async () => {
  const f = fixture();
  const [a, b] = await Promise.all([createProject(f.ctx, '研究', at()), createProject(f.ctx, '运动', at())]);
  expect(a.color).not.toBe(b.color);
  for (const name of ['待机', '休息', '睡眠', '离线', '回顾', '未分类', ' 研究 ']) await expect(createProject(f.ctx, name, at())).rejects.toThrow('保留');
  expect((await f.ctx.repos.settings.read()).lists.projects).toEqual([a, b]);
});
it('favorites are atomic, deduplicated templates; edits/deletes and full reorder preserve popup presets', async () => {
  const f = fixture(); const ids = await Promise.all([addFavorite(f.ctx, value, at()), addFavorite(f.ctx, value, at())]);
  expect(ids[0]).toBe(ids[1]);
  const b = await addFavorite(f.ctx, { ...value, description: '运动' }, at());
  await editFavorite(f.ctx, b, { ...value, description: '跑步', tags: ['户外'] }, at());
  await reorderFavorites(f.ctx, [b, ids[0]], at());
  expect(f.ctx.settings.lists.presets.map(item => item.id)).toEqual([b, ids[0], 'wc']);
  await expect(reorderFavorites(f.ctx, [b, b], at())).rejects.toThrow('排序');
  await expect(editFavorite(f.ctx, b, value, at())).rejects.toThrow('同名');
  await removeFavorite(f.ctx, b, at()); expect(f.ctx.settings.lists.presets.map(item => item.id)).toEqual([ids[0], 'wc']);
  await beginPending(f.ctx, at()); const pending = f.home().pending;
  f.clock(at(5)); await beginPending(f.ctx, at(5)); expect(f.home().pending).toEqual(pending);
  await startPreset(f.ctx, ids[0], at(5)); expect(open(f)).toMatchObject({ started_at: at(), description: '学习', card_id: null });
  expect(await favorite(f.ctx, open(f).id, at(5))).toBe(ids[0]);
  expect(f.ctx.settings.lists.presets[0]).not.toHaveProperty('card_id');
});

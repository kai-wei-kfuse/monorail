import { expect, it, vi } from 'vitest';
import { fixture, at, card, project, seed } from './serviceFixture';
import { change, changeLists, applyPlatform, changeDataDirectory } from './settingsService';
import { createContext, run } from './commit';
import { createProject } from './backpackService';
import { insert } from './timerService';
import { createRecord } from '../domain/record/record';
import type { SettingsPlatform } from '../platform/settings';

function platform(): SettingsPlatform {
  return { setHotkey: vi.fn(async () => {}), setAutostart: vi.fn(async () => {}), setAlwaysOnTop: vi.fn(async () => {}) };
}
it('settings write updates durable settings, context, projection, and the next queued operation', async () => {
  const f = fixture(); await seed(f, [], [project('main')]);
  const commands = [change(f.ctx, 'mainSlots', 2, at()), createProject(f.ctx, { name: 'second', slot: '主线', makeRoom: null }, at())];
  await Promise.all(commands);
  expect((await f.ctx.repos.settings.read()).mainSlots).toBe(2); expect(f.ctx.settings.mainSlots).toBe(2);
  expect(f.publish.mock.calls.at(-1)![0].settings.mainSlots).toBe(2);
  expect((await f.ctx.repos.projects.list()).filter(row => row.value.slot === '主线')).toHaveLength(2);
});
it('concurrent single and list modifications merge against the latest serialized setting values', async () => {
  const f = fixture();
  await Promise.all([change(f.ctx, 'betWeeks', 2, at()), change(f.ctx, 'accent', '#20b8ff', at()),
    changeLists(f.ctx, { quickActivities: [{ id: 'walk', name: '走走', category: '运动' }] }, at()),
    changeLists(f.ctx, { restPool: [{ id: 'look', name: '看窗外' }] }, at())]);
  const settings = await f.ctx.repos.settings.read();
  expect(settings).toMatchObject({ betWeeks: 2, accent: '#20b8ff', lists: { quickActivities: [{ id: 'walk', name: '走走', category: '运动' }], restPool: [{ id: 'look', name: '看窗外' }], idleName: '待机' } });
  await insert(f.ctx, 'walk', at()); expect(f.publish.mock.calls.at(-1)![0].home.activity.label).toBe('走走');
});
it('schema violations return errors by key, leave persistence unchanged, and do not poison the queue', async () => {
  const f = fixture(); const before = structuredClone(f.ctx.settings);
  expect(await change(f.ctx, 'betWeeks', 0, at())).toMatchObject({ ok: false, errors: { betWeeks: expect.any(String) } });
  expect(f.ctx.settings).toEqual(before);
  await expect(changeLists(f.ctx, { restPool: [{ id: 'x', name: ' ' }, { id: 'x', name: 'duplicate' }] }, at())).rejects.toThrow('invalid settings');
  expect(await change(f.ctx, 'betWeeks', 3, at())).toEqual({ ok: true });
});
it('hotkey registration failure is returned on the correct row and does not save the failed setting', async () => {
  const f = fixture(), native = platform(); f.ctx.settingsPlatform = native;
  vi.mocked(native.setHotkey).mockRejectedValueOnce(new Error('OS shortcut occupied'));
  const old = f.ctx.settings.quickbarHotkey;
  expect(await change(f.ctx, 'quickbarHotkey', 'Ctrl+Alt+P', at())).toEqual({ ok: false, errors: { quickbarHotkey: 'OS shortcut occupied' } });
  expect(f.ctx.settings.quickbarHotkey).toBe(old); expect((await f.ctx.repos.settings.read()).quickbarHotkey).toBe(old);
  expect(await change(f.ctx, 'mainHotkey', 'Ctrl+Alt+M', at())).toEqual({ ok: true });
  expect(native.setHotkey).toHaveBeenLastCalledWith('mainHotkey', 'Ctrl+Alt+M');
});
it('autostart and pinning apply immediately, missing platform is explicit, and startup reports each failure', async () => {
  const f = fixture(); expect(await change(f.ctx, 'autostart', false, at())).toMatchObject({ ok: false, errors: { autostart: '未注入系统设置能力' } });
  const native = platform(); f.ctx.settingsPlatform = native;
  await change(f.ctx, 'autostart', false, at()); await change(f.ctx, 'alwaysOnTop', true, at());
  expect(native.setAutostart).toHaveBeenLastCalledWith(false); expect(native.setAlwaysOnTop).toHaveBeenLastCalledWith(true);
  vi.mocked(native.setHotkey).mockRejectedValue(new Error('conflict')); vi.mocked(native.setAutostart).mockRejectedValueOnce(new Error('registry denied'));
  expect(await applyPlatform(f.ctx)).toEqual({ quickbarHotkey: 'conflict', mainHotkey: 'conflict', autostart: 'registry denied' });
  expect(native.setAlwaysOnTop).toHaveBeenCalledTimes(2);
});
it('committing settings fails loudly, publishes nothing, and only recovery adopts the journal value', async () => {
  const f = fixture(); const original = structuredClone(f.ctx.settings);
  vi.spyOn(f.ctx.repos, 'transact').mockRejectedValueOnce(new Error('disk failed'));
  await expect(change(f.ctx, 'betWeeks', 3, at())).rejects.toThrow('disk failed');
  expect(f.ctx.settings).toEqual(original); expect(f.publish).not.toHaveBeenCalled();
  await expect(change(f.ctx, 'betWeeks', 2, at())).rejects.toThrow('提交已阻塞');
});
it('settings immediately re-evaluate reminders, review due date and idea expiry without evicting over-capacity projects', async () => {
  const f = fixture(); const now = new Date(2026, 10, 3, 10).toISOString();
  await seed(f, [card('due', { due_at: now })], [project('a'), project('b', '主线', 2)]);
  await run(f.ctx, async tx => {
    tx.state.first_used_day = '2026-10-01';
    tx.saveRecord(createRecord({ id: tx.id(), text: 'old', kind: '想法', created_at: new Date(2026, 9, 1, 10).toISOString(),
      due_at: null, blocking: false, project_id: null, card_id: null, tags: [], attachments: [] }));
  });
  f.clock(now); await change(f.ctx, 'ideaExpireDays', 7, now); await change(f.ctx, 'deadlineLeadMinutes', 30, now);
  expect((await f.ctx.repos.records.list())[0].value.pool).toBe('冷库');
  expect(f.update).toHaveBeenLastCalledWith(expect.arrayContaining([expect.objectContaining({ at: Date.parse(now) - 30 * 60_000 })]));
  expect((await f.ctx.repos.projects.list()).filter(row => row.value.status === '进行中')).toHaveLength(2);
  const restarted = createContext({ ...f.ctx, settings: await f.ctx.repos.settings.read() });
  expect(restarted.settings.ideaExpireDays).toBe(7);
});
it('data directory delegates to the app-owned operation and propagates failure', async () => {
  const changeDataDirectoryPort = vi.fn(async () => {}); await changeDataDirectory({ changeDataDirectory: changeDataDirectoryPort });
  expect(changeDataDirectoryPort).toHaveBeenCalledOnce();
  await expect(changeDataDirectory({ changeDataDirectory: async () => { throw new Error('switch failed'); } })).rejects.toThrow('switch failed');
});

// 0.3.0-beta.3 E8a3：动作与来源。从入口开始，断言最终改数据那次提交的历史（动作、来源、主体、改动）；
// 快速记录条「先补记、再消费」；设置的系统副作用；后台入口有实质改动才写「系统」。
import { describe, expect, it, vi } from 'vitest';
import { createActions } from './actions';
import { handleApplicationRequest } from './applicationController';
import { at, card, fixture, getCard, open, runTx, seed, task } from '../services/serviceFixture';
import type { Fixture } from '../services/serviceFixture';
import { createContext } from '../services/commit';
import { dispatchMiniCommand, settleOffline, startCard, startFree, timerStateTokenInTx } from '../services/homeService';
import { reconcile } from '../services/recordService';
import { editIdea } from '../services/ideaService';
import { applyPlatform, change } from '../services/settingsService';
import * as edit from '../services/timeEditService';
import { projectMini } from '../services/miniProjection';
import { createRecord } from '../domain/record/record';
import type { RecordEntry } from '../domain/record/record';
import { SYSTEM_WHY } from '../shared/history';
import type { HistoryRecord } from '../shared/history';
import type { SettingsPlatform } from '../platform/settings';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

const history = async (f: Fixture): Promise<HistoryRecord[]> => (await f.ctx.repos.history.readDays('2000-01-01', '2999-12-31')).records;
const of = async (f: Fixture, action: string) => (await history(f)).filter(r => r.action === action);
const record = async (f: Fixture, id: string): Promise<RecordEntry> => (await f.ctx.repos.records.get(id))!.value;
const daysAgo = (n: number) => new Date(2026, 9, 27 - n, 10).toISOString();

/** 模拟快速记录条窗口：不经主窗口的事务，直接把记录写进数据目录 */
async function quickbar(f: Fixture, kind: '待办' | '想法', text: string, createdAt = at(), via: 'quickbar' | null = 'quickbar') {
  const id = crypto.randomUUID();
  const value = createRecord({ id, text, kind, created_at: createdAt, due_at: null, blocking: false, task_id: null, card_id: null,
    tags: [], attachments: [], ...(via ? { created_via: via } : {}) });
  await f.ctx.repos.transact(crypto.randomUUID(), [await f.ctx.repos.records.write(value, null)]);
  return id;
}
function miniSeen(f: Fixture) {
  const s = projectMini(f.ctx.snapshot()!, f.ctx.mainEpoch);
  return { requestId: crypto.randomUUID(), at: f.ctx.now(), entryId: s.entryId, cardId: s.cardId, epoch: s.epoch };
}
function platform(): SettingsPlatform {
  return { setHotkey: vi.fn(async () => {}), setAutostart: vi.fn(async () => {}), setAlwaysOnTop: vi.fn(async () => {}) };
}

describe('快速记录条：先补记、再消费', () => {
  it('待办：下一个事务先写「快速记录条」历史（at 取创建时刻，卡片任务作连带），用户动作的历史里不含吸收的改动', async () => {
    const f = fixture(); await seed(f, []);
    f.clock(at(5)); const id = await quickbar(f, '待办', '买牛奶', at(1));
    expect(await change(f.ctx, 'accent', '#20b8ff', at(5))).toEqual({ ok: true });
    const [captured] = await of(f, 'quickbar.capture');
    expect(captured).toMatchObject({ at: at(1), day: '2026-10-27', source: { kind: 'manual', via: 'quickbar' }, subject: { type: 'record', id, text: '买牛奶' } });
    expect(captured.changes.length).toBeGreaterThan(0);
    expect(captured.changes.every(c => c.type === 'record')).toBe(true);
    expect(captured.effects.map(c => c.type)).toEqual(expect.arrayContaining(['card', 'task']));
    const [setting] = await of(f, 'settings.change');
    // 吸收的新建（记录、卡片、任务）不算进用户动作；改设置后重新出卡带来的状态变化可以有
    expect([...setting.changes, ...setting.effects].every(c => c.type !== 'record' && c.before !== null)).toBe(true);
    expect(await record(f, id)).toMatchObject({ created_via: 'quickbar', history_logged_at: at(5), card_id: `card-${id}` });
  });
  it('只存一条想法：没有别的改动也写一条「新记录」历史；之后的事务不再补记', async () => {
    const f = fixture(); await seed(f, []);
    const id = await quickbar(f, '想法', '一个点子');
    await runTx(f.ctx, async () => {});
    await runTx(f.ctx, async () => {});
    const list = await of(f, 'quickbar.idea');
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ subject: { type: 'record', id, text: '一个点子', meta: '想法' } });
    expect(await of(f, 'test.direct')).toHaveLength(1);   // seed 那一次；两次空事务都没写
  });
  it('保存后、主窗口收到通知前就被 MCP 提交读到：先补记，计时状态令牌不变，MCP 照常提交', async () => {
    const f = fixture(); await seed(f, [card('c', { task_id: 't' })], [task('t')]);
    await startCard(f.ctx, 'c', at());
    const token = await runTx(f.ctx, async tx => timerStateTokenInTx(tx));
    await quickbar(f, '待办', '回邮件');
    expect(await runTx(f.ctx, async tx => timerStateTokenInTx(tx))).toBe(token);
    await quickbar(f, '想法', '再一个');
    await handleApplicationRequest(f.ctx, { method: 'pause_timer', arguments: { operation_id: crypto.randomUUID(), expected_state: token } });
    expect(await of(f, 'quickbar.capture')).toHaveLength(1);
    expect(await of(f, 'quickbar.idea')).toHaveLength(1);
    const [paused] = await of(f, 'auto.pause_timer');
    expect([...paused.changes, ...paused.effects].every(c => c.type !== 'record')).toBe(true);
  });
  it('通知延迟后用户先编辑：补记的是原文，编辑另记一条', async () => {
    const f = fixture(); await seed(f, []);
    const id = await quickbar(f, '想法', '原文');
    await editIdea(f.ctx, id, { text: '改过', needs: null }, at(1));
    expect((await of(f, 'quickbar.idea'))[0].subject).toMatchObject({ id, text: '原文' });
    expect((await of(f, 'idea.edit'))[0].changes).toEqual(expect.arrayContaining([expect.objectContaining({ before: '原文', after: '改过' })]));
  });
  it('两个 reconcile 同时处理：只补记一次、只生成一张卡', async () => {
    const f = fixture(); await seed(f, []);
    const id = await quickbar(f, '待办', '交作业');
    await Promise.all([reconcile(f.ctx), reconcile(f.ctx)]);
    expect(await of(f, 'quickbar.capture')).toHaveLength(1);
    expect((await f.ctx.repos.cards.list()).filter(row => row.value.source_record_id === id)).toHaveLength(1);
  });
  it('吸收途中 journal 失败：业务和标记都没落盘，重启后补记一次', async () => {
    const f = fixture(); await seed(f, []);
    const id = await quickbar(f, '想法', '断电前');
    vi.spyOn(f.ctx.repos, 'transact').mockRejectedValueOnce(new Error('power loss'));
    await expect(runTx(f.ctx, async () => {})).rejects.toThrow('power loss');
    expect((await record(f, id)).history_logged_at).toBeUndefined();
    const restarted = createContext({ ...f.ctx, settings: await f.ctx.repos.settings.read() });
    await runTx(restarted, async () => {});
    expect(await of(f, 'quickbar.idea')).toHaveLength(1);
  });
  it('无标记的老记录不补记；已标记但历史被清理的不重写；创建时刻在保留期外的只标记（待办照样生成卡片）', async () => {
    const f = fixture(); await seed(f, []);
    const old = await quickbar(f, '想法', '老记录', at(), null);
    const cleaned = await quickbar(f, '想法', '已清理');
    await runTx(f.ctx, async () => {});
    await f.ctx.repos.history.removeBefore('2999-12-31');
    const expired = await quickbar(f, '待办', '很久以前', daysAgo(200));
    const edge = await quickbar(f, '想法', '保留期最后一天', daysAgo(179));
    await runTx(f.ctx, async () => {});
    expect((await record(f, old)).history_logged_at).toBeUndefined();
    expect((await record(f, cleaned)).history_logged_at).toBe(at());
    expect((await history(f)).filter(r => r.action.startsWith('quickbar.')).map(r => r.subject?.id)).toEqual([edge]);
    expect(await record(f, expired)).toMatchObject({ history_logged_at: at(), card_id: `card-${expired}` });
  });
});

describe('来源', () => {
  it('0.3.0-beta.4 D1：小窗写新事件时选中收藏，历史记「开始收藏 · 小窗」', async () => {
    const f = fixture(); await seed(f, []);
    f.ctx.settings.lists.presets = [{ id: 'fav', name: '背单词', project: '学习', tags: [], mode: '切换', place: '计时条' }];
    await dispatchMiniCommand(f.ctx, { ...miniSeen(f), type: 'beginPending', pending_id: null });
    const s = projectMini(f.ctx.snapshot()!, f.ctx.mainEpoch);
    await dispatchMiniCommand(f.ctx, { ...miniSeen(f), type: 'startFavorite', revision: s.revision, pending_id: s.pending_id, presetId: 'fav' });
    const [started] = await of(f, 'mini.startFavorite');
    expect(started).toMatchObject({ label: '开始收藏', source: { kind: 'manual', via: 'mini' } });
  });
  it('小窗完成卡片走完全链路：小窗命令本身不写历史，主窗口对话框确认后那次提交记「小窗」', async () => {
    const f = fixture(); await seed(f, [card('c', { task_id: 't' }), card('d', { task_id: 't' })], [task('t')]);
    await startCard(f.ctx, 'c', at()); f.clock(at(10));
    const outcome = await dispatchMiniCommand(f.ctx, { ...miniSeen(f), type: 'complete', cardId: 'c' });
    expect(outcome).toEqual({ kind: 'complete', cardId: 'c', at: at(10) });
    expect(await of(f, 'mini.complete')).toHaveLength(0);
    const report = vi.fn(), actions = createActions(f.ctx, report);
    if (outcome.kind !== 'complete') throw new Error('unreachable');
    await actions.complete(outcome.cardId, outcome.at, '做完了', false, true);
    expect(report).not.toHaveBeenCalled();
    expect((await getCard(f, 'c')).status).toBe('已完成');
    const [done] = await of(f, 'card.complete');
    expect(done).toMatchObject({ at: at(10), source: { kind: 'manual', via: 'mini' }, subject: { type: 'card', id: 'c' } });
    f.clock(at(12)); await startCard(f.ctx, 'd', at(11));
    await actions.complete('d', at(12), '', false);
    expect((await of(f, 'card.complete')).find(r => r.subject?.id === 'd')!.source).toEqual({ kind: 'manual', via: 'main', page: 'home' });
  });
  it('日历和列表共用入口：页面由调用方传入，缺省记日历；主体是被改的那一条', async () => {
    const f = fixture(); await seed(f, []);
    const id = await edit.create(f.ctx, at(-60), at(-30), at(), undefined, { kind: 'manual', via: 'main', page: 'calendar' });
    await edit.patch(f.ctx, id, { description: '列表里改' }, at(1), { kind: 'manual', via: 'main', page: 'list' });
    await edit.patch(f.ctx, id, { description: '缺省' }, at(2));
    const patches = await of(f, 'entry.patch');
    expect(patches.map(r => r.source)).toEqual(expect.arrayContaining([{ kind: 'manual', via: 'main', page: 'list' }, { kind: 'manual', via: 'main', page: 'calendar' }]));
    expect(patches.every(r => r.subject?.type === 'entry' && r.subject.id === id)).toBe(true);
    expect((await of(f, 'entry.create'))[0].subject).toMatchObject({ type: 'entry', id });
  });
  it('临时活动「存为快捷活动」：两次提交各一条，列表设置那条记首页', async () => {
    const f = fixture(); await seed(f, []);
    const actions = createActions(f.ctx, vi.fn());
    await actions.tempActivity('拿外卖', true, at());
    expect((await of(f, 'settings.changeLists'))[0]).toMatchObject({ source: { kind: 'manual', via: 'main', page: 'home' }, subject: { type: 'settings' } });
    expect(await of(f, 'home.insert')).toHaveLength(1);
  });
  it('临时活动的项目（已定 62）：手写不选记「未分类」；选了项目就记它，存为快捷活动时也按它存', async () => {
    const f = fixture(); await seed(f, []);
    f.ctx.settings = { ...f.ctx.settings, lists: { ...f.ctx.settings.lists, projects: [{ name: '学习', color: '#1aa3ff' }] } };
    const actions = createActions(f.ctx, vi.fn());
    await actions.tempActivity('倒水', false, at());
    expect(open(f)).toMatchObject({ description: '倒水', project: '未分类' });
    f.clock(at(2)); await actions.tempActivity('查资料', true, at(2), '学习');
    expect(open(f)).toMatchObject({ description: '查资料', project: '学习' });
    expect(f.ctx.settings.lists.presets.find(p => p.name === '查资料')).toMatchObject({ project: '学习', place: '弹层' });
  });
  it('后台入口：有实质改动写「系统」并附原因，没有就不写', async () => {
    const f = fixture(); await seed(f, []);
    await quickbar(f, '待办', '老待办', at(), null);    // 不是快速记录条存的：由 reconcile 生成卡片
    await reconcile(f.ctx);
    const [rec] = await of(f, 'system.reconcile');
    expect(rec).toMatchObject({ source: { kind: 'system', trigger: 'reconcile' }, why: SYSTEM_WHY.reconcile });
    await reconcile(f.ctx);
    expect(await of(f, 'system.reconcile')).toHaveLength(1);
    await startFree(f.ctx, { description: '写代码', project: '学习', tags: [] }, at());
    f.clock(at(3)); await settleOffline(f.ctx, { start: at(1), end: at(3) });         // 不到 5 分钟：不追问
    expect(await of(f, 'system.resume')).toHaveLength(0);
    f.clock(at(40)); await settleOffline(f.ctx, { start: at(10), end: at(40) });
    expect((await of(f, 'system.resume'))[0]).toMatchObject({ source: { kind: 'system', trigger: 'resume' }, why: SYSTEM_WHY.resume });
  });
  it('自动化 runOperation 必带动作：controller 的写方法记 auto.<方法>', async () => {
    const f = fixture(); await seed(f, []);
    await handleApplicationRequest(f.ctx, { method: 'save_idea', arguments: { operation_id: crypto.randomUUID(), text: '外部想法' } });
    expect((await of(f, 'auto.save_idea'))[0]).toMatchObject({ label: '保存想法', call: { method: 'save_idea' } });
  });
});

describe('设置的系统副作用（ADR 0019 第 9 条）', () => {
  it('正常修改：系统接口在领域改动之后调用，历史记这一项', async () => {
    const f = fixture(), native = platform(); f.ctx.settingsPlatform = native;
    expect(await change(f.ctx, 'quickbarHotkey', 'Ctrl+Alt+P', at())).toEqual({ ok: true });
    expect(native.setHotkey).toHaveBeenLastCalledWith('quickbarHotkey', 'Ctrl+Alt+P');
    expect((await of(f, 'settings.change'))[0]).toMatchObject({ subject: { type: 'settings', id: 'quickbarHotkey' }, source: { kind: 'manual', via: 'main', page: 'settings' } });
  });
  it('系统接口拒绝：整个事务不提交，不写历史', async () => {
    const f = fixture(), native = platform(); f.ctx.settingsPlatform = native;
    vi.mocked(native.setHotkey).mockRejectedValueOnce(new Error('占用'));
    const old = f.ctx.settings.quickbarHotkey;
    expect(await change(f.ctx, 'quickbarHotkey', 'Ctrl+Alt+P', at())).toEqual({ ok: false, errors: { quickbarHotkey: '占用' } });
    expect((await f.ctx.repos.settings.read()).quickbarHotkey).toBe(old);
    expect(await of(f, 'settings.change')).toHaveLength(0);
  });
  it('系统接口成功而 journal 失败：队列封锁，重启后按持久设置重放', async () => {
    const f = fixture(), native = platform(); f.ctx.settingsPlatform = native;
    const old = f.ctx.settings.quickbarHotkey;
    vi.spyOn(f.ctx.repos, 'transact').mockRejectedValueOnce(new Error('disk failed'));
    await expect(change(f.ctx, 'quickbarHotkey', 'Ctrl+Alt+P', at())).rejects.toThrow('disk failed');
    expect(native.setHotkey).toHaveBeenLastCalledWith('quickbarHotkey', 'Ctrl+Alt+P');
    await expect(change(f.ctx, 'accent', '#20b8ff', at())).rejects.toThrow('提交已阻塞');
    const restarted = createContext({ ...f.ctx, settings: await f.ctx.repos.settings.read() });
    restarted.settingsPlatform = native;
    expect(await applyPlatform(restarted)).toEqual({});
    expect(native.setHotkey).toHaveBeenCalledWith('quickbarHotkey', old);
    expect(await history(f)).toHaveLength(0);
  });
});

describe('自动化来源（E8a4）', () => {
  it('请求带 origin：历史来源记 MCP / CLI 和调用方（去控制字符、限长）；不带记「自动化 · 未识别」', async () => {
    const f = fixture(); await seed(f, []);
    let minute = 0;
    const save = (text: string, origin?: unknown) => { f.clock(at(++minute)); return handleApplicationRequest(f.ctx, {
      method: 'save_idea', arguments: { operation_id: crypto.randomUUID(), text }, ...(origin ? { origin } : {}) }); };
    await save('来自 MCP', { kind: 'mcp', agent: { name: null, raw: 'claude-ai', version: '0.14.2', detected_by: 'mcp_handshake' } });
    await save('来自 CLI', { kind: 'cli', agent: { name: `手环\u0007同步${'x'.repeat(80)}`, detected_by: 'flag', evidence: '--agent 手环同步' } });
    await save('旧客户端');
    await save('坏的 origin', { kind: 'browser', agent: {} });
    const list = (await of(f, 'auto.save_idea')).reverse();
    expect(list.map(r => r.source)).toEqual([
      { kind: 'mcp', agent: { name: null, raw: 'claude-ai', version: '0.14.2', detected_by: 'mcp_handshake' } },
      { kind: 'cli', agent: { name: `手环同步${'x'.repeat(60)}`, detected_by: 'flag', evidence: '--agent 手环同步' } },
      { kind: 'automation', agent: { name: null, detected_by: 'none' } },
      { kind: 'automation', agent: { name: null, detected_by: 'none' } },
    ]);
  });
});

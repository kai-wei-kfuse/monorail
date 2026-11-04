// 0.3.0-beta.3 E8d 第 4 条（审核 G8）：长期数据下操作历史的开销。打印实测值供证据记录；断言只设宽松上限防止明显退化，
// 不把测试机（内存文件系统）的速度写成真机结论。真机（Tauri 文件 IPC）的数字未测，归入 E9。
import { expect, it } from 'vitest';
import { MemoryFs } from '../data/memoryFs';
import { createRepos } from '../data/repos';
import { defaults } from '../shared/settings';
import { createRecord } from '../domain/record/record';
import type { HistoryRecord } from '../shared/history';
import { createContext, run } from './commit';
import { list, recentAutomation, shiftDay } from './historyService';

it('180 days of history and a burst of quick-bar records stay within a generous bound; prints the measured times', async () => {
  const fs = new MemoryFs(), repos = createRepos(fs);
  let reads = 0; const read = fs.read.bind(fs); fs.read = path => { reads++; return read(path); };
  const now = new Date(2026, 10, 4, 10).toISOString();
  const ctx = createContext({ repos, settings: structuredClone(defaults), id: () => crypto.randomUUID(), now: () => now,
    publish: () => {}, log: async () => {}, reminders: { update: async () => {} } });
  // 一年的记录量级：2000 条想法（业务数据），180 天 × 30 条历史
  const ideas = Array.from({ length: 2000 }, (_, i) => createRecord({ id: crypto.randomUUID(), text: `想法 ${i}`, kind: '想法',
    created_at: new Date(Date.parse(now) - i * 3_600_000).toISOString(), due_at: null, blocking: false, task_id: null, card_id: null, tags: [], attachments: [] }));
  await repos.transact(crypto.randomUUID(), await Promise.all(ideas.map(r => repos.records.write(r, null))));
  for (let d = 0; d < 180; d++) {
    const day = shiftDay('2026-11-04', -d);
    for (let i = 0; i < 30; i++) {
      const at = new Date(`${day}T${String(8 + Math.floor(i / 3)).padStart(2, '0')}:${String((i % 3) * 20).padStart(2, '0')}:00`).toISOString();
      const r: HistoryRecord = { version: 1, id: `h${d}x${i}`, at, day, action: 'test.direct', label: '开始计时',
        source: i % 3 ? { kind: 'manual', via: 'main', page: 'home' } : { kind: 'mcp', agent: { name: 'Cursor', raw: 'cursor-vscode', detected_by: 'mcp_handshake' } },
        subject: { type: 'entry', id: `e${d}${i}`, text: '活动', meta: '工作 · 11.04 08:00–至今' },
        changes: [{ type: 'entry', id: `e${d}${i}`, name: '活动', field: '时间', before: null, after: '11.04 08:00–至今' }], effects: [] };
      const w = repos.history.write(r); await fs.atomicWrite(w.path, w.text);
    }
  }
  const times: Record<string, number> = {}, counts: Record<string, number> = {};
  const measure = async <T>(name: string, work: () => Promise<T>): Promise<T> => {
    reads = 0; const heap = process.memoryUsage().heapUsed, t0 = performance.now();
    const out = await work();
    times[name] = Math.round(performance.now() - t0); counts[`${name}.reads`] = reads;
    counts[`${name}.heapMB`] = Math.round((process.memoryUsage().heapUsed - heap) / 1048576);
    return out;
  };
  await run(ctx, async () => {}, undefined, { action: 'test.direct' });   // 先开出待机
  // 50 条快速记录条的记录同时到达（25 待办 + 25 想法），下一个事务一次吸收
  const burst = Array.from({ length: 50 }, (_, i) => createRecord({ id: crypto.randomUUID(), text: `快速 ${i}`, kind: i % 2 ? '想法' : '待办', created_at: now,
    due_at: null, blocking: false, task_id: null, card_id: null, tags: [], attachments: [], created_via: 'quickbar' }));
  await repos.transact(crypto.randomUUID(), await Promise.all(burst.map(r => repos.records.write(r, null))));
  // 队列等待：吸收那一次提交排在前面时，紧跟着的一次空提交要等多久
  let queued = 0;
  await measure('absorb50', async () => {
    const first = run(ctx, async () => {}, undefined, { action: 'test.direct' });
    const t0 = performance.now(); const second = run(ctx, async () => {}, undefined, { action: 'test.direct' });
    await first; await second; queued = Math.round(performance.now() - t0);
  });
  counts.queueWaitMs = queued;
  const week = await measure('list7', () => list(ctx, 7));
  const all = await measure('list180', () => list(ctx, 180));
  const recent = await measure('recent5', () => recentAutomation(ctx, 5));
  // 预置的历史 + 50 条快速记录条补记 + 开出待机那一次
  expect(week.records.length).toBe(7 * 30 + 50 + 1);
  expect(all.records.length).toBe(180 * 30 + 50 + 1);
  expect(recent).toHaveLength(5);
  console.log(`HISTORY_PERF ${JSON.stringify({ times, counts })}`);
  for (const ms of Object.values(times)) expect(ms).toBeLessThan(10_000);
}, 30_000);

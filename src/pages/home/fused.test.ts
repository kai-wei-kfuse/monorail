import { describe, expect, it } from 'vitest';
import { fusedState } from './fused';
import type { TimerEntry } from './TimerBar';

const e = (more: Partial<TimerEntry> = {}): TimerEntry =>
  ({ id: 'e', description: '写周报', project: '工作', tags: [], startedAt: '2026-10-28T08:00:00Z', cardId: null, kind: '普通', ...more });
const idle = { entry: e({ id: 'i', project: '待机', description: '待机' }), idle: true, pending: null, paused: null };
const pending = { id: 'p', startedAt: '2026-10-28T08:00:00Z' };
const ready = { id: 'k', status: '待做' as const }, doing = { id: 'k', status: '进行中' as const };

describe('fusedState', () => {
  it('待机：输入框，读数不能点', () => expect(fusedState(idle, null, false)).toMatchObject({ show: 'input', target: null }));
  it('待确认：读数改起点', () => expect(fusedState({ ...idle, pending }, null, false).target).toEqual({ mode: 'pending', id: 'p' }));
  it('抽到卡：显示卡，待确认算在卡上；点了「写别的」换回输入框', () => {
    expect(fusedState({ ...idle, pending }, ready, false)).toMatchObject({ show: 'card', pendingOnCard: true, target: { mode: 'pending', id: 'p' } });
    expect(fusedState({ ...idle, pending }, ready, true)).toMatchObject({ show: 'input', pendingOnCard: false });
  });
  it('做卡中：读数改卡的已用', () =>
    expect(fusedState({ ...idle, entry: e({ cardId: 'k' }), idle: false }, doing, false)).toMatchObject({ show: 'card', onCard: true, target: { mode: 'ref', id: 'k' } }));
  it('做卡时暂停、插了快捷活动：还显示卡，读数不能点', () => {
    expect(fusedState({ ...idle, entry: e({ project: '待机', kind: '暂停' }), paused: '改简历' }, doing, false)).toMatchObject({ show: 'card', paused: true, target: null });
    expect(fusedState({ ...idle, entry: e({ description: '厕所', kind: '插入' }), idle: false }, doing, false)).toMatchObject({ show: 'card', away: true, target: null });
  });
  it('正在计自己写的事、抽到的卡没开始：输入框显示这件事，读数改这一条', () =>
    expect(fusedState({ ...idle, entry: e(), idle: false }, ready, false)).toMatchObject({ show: 'input', target: { mode: 'entry', id: 'e' } }));
});

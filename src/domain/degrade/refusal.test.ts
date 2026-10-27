import { expect, it } from 'vitest';
import { defaults } from '../../shared/settings';
import { registerRefusal, finishRest } from './refusal';
import type { RefusalState } from './refusal';

const at = (minute: number) => new Date(Date.parse('2026-10-27T00:00:00Z') + minute * 60000).toISOString();
it('A7 enters rest at the fourth executed rejection, then emits input hint after the next threshold', () => {
  let state: RefusalState = { refusals: [], last_rest_ended_at: null };
  for (let minute = 0; minute < 3; minute++) { const next = registerRefusal(state, at(minute), defaults); expect(next.action).toBe('none'); state = next.state; }
  const fourth = registerRefusal(state, at(3), defaults); expect(fourth.action).toBe('rest');
  state = finishRest(fourth.state, at(5)); expect(state.refusals).toEqual([]);
  for (let minute = 6; minute < 9; minute++) state = registerRefusal(state, at(minute), defaults).state;
  const next = registerRefusal(state, at(9), defaults); expect(next.action).toBe('input'); expect(next.state.refusals).toEqual([]);
});
it('expires old refusals and respects configured thresholds without mutating input', () => {
  const state: RefusalState = { refusals: [at(0), at(1), at(2)], last_rest_ended_at: null };
  const next = registerRefusal(state, at(63), defaults);
  expect(next.state.refusals).toEqual([at(63)]); expect(state.refusals).toHaveLength(3);
  expect(registerRefusal({ refusals: [at(62)], last_rest_ended_at: null }, at(63), { ...defaults, refusalThreshold: 2 }).action).toBe('rest');
});

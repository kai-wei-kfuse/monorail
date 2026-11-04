// 0.3.0-beta.3 D4：小窗的会话世代守卫。
import { expect, it, vi } from 'vitest';
import { epochGuard, isNewSession } from './miniSession';

it('a callback started in an older session is dropped once a newer session takes over', () => {
  let current = 3;
  const guard = epochGuard(() => current), seen = vi.fn();
  const old = guard.bind(3, seen);
  old('first'); expect(seen).toHaveBeenCalledWith('first');
  current = 4;
  old('late reply'); old('late confirm');
  expect(seen).toHaveBeenCalledTimes(1);
  guard.bind(4, seen)('fresh'); expect(seen).toHaveBeenLastCalledWith('fresh');
  expect([guard.isCurrent(3), guard.isCurrent(4)]).toEqual([false, true]);
});
it('only a strictly larger epoch after a known one counts as a new session', () => {
  expect(isNewSession(null, 1)).toBe(false);
  expect(isNewSession(1, 1)).toBe(false);
  expect(isNewSession(1, 2)).toBe(true);
  expect(isNewSession(3, 2)).toBe(false);
});

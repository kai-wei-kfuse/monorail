import { afterEach, expect, it, vi } from 'vitest';
import { scrambleDigits } from './reveal';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function animation() {
  const callbacks = new Map<number, FrameRequestCallback>();
  let next = 0;
  vi.spyOn(performance, 'now').mockReturnValue(0);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callbacks.set(++next, callback); return next; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => callbacks.delete(id));
  vi.spyOn(Math, 'random').mockReturnValueOnce(0).mockReturnValueOnce(.4).mockReturnValueOnce(0).mockReturnValueOnce(.7);
  const el = { textContent: '00:27', dataset: {} } as HTMLElement;
  const frame = (at: number) => { const pending = [...callbacks.values()]; callbacks.clear(); pending.forEach(callback => callback(at)); };
  return { el, frame, callbacks };
}

it('a cold intro cannot replace a paused React timer with its last random frame (real readout bug)', () => {
  const { el, frame } = animation();
  scrambleDigits(el, 420, 520);
  frame(500);
  expect(el.dataset.scramble).toBe('04:07');
  expect(el.textContent).toBe('00:27');
  frame(941);
  // React need not rewrite an unchanged 00:27 value while the card is away.
  expect(el.textContent).toBe('00:27');
  expect(el.dataset.scramble).toBeUndefined();
});

it('cancelling the animation preserves a timer update received while it was running', () => {
  const { el, frame, callbacks } = animation();
  const cancel = scrambleDigits(el, 420, 520);
  frame(500); el.textContent = '00:28'; frame(600); cancel();
  expect(el.textContent).toBe('00:28');
  expect(callbacks.size).toBe(0);
  expect(el.dataset.scramble).toBeUndefined();
});

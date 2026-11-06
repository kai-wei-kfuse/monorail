import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
import { StatusBlock } from './StatusBlock';

afterEach(() => vi.useRealTimers());
const render = (startedAt: string | null, offsetMs?: number) => renderToStaticMarkup(createElement(StatusBlock,
  { kind: 'off', label: '已暂停：回消息', startedAt, offsetMs, onClick: () => {} }));

it('keeps the cumulative insert readout frozen while paused, including zero', () => {
  expect(render(null, 120_000)).toContain('>02:00<');
  expect(render(null, 0)).toContain('>00:00<');
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-06T08:00:00Z'));
  expect(render(null, 120_000)).toContain('>02:00<');
  vi.setSystemTime(new Date('2026-11-06T08:02:00Z'));
  expect(render(null, 120_000)).toContain('>02:00<');
});

it('adds a running tail to the cumulative time and keeps loose idle unspecified', () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-06T08:01:00Z'));
  expect(render('2026-11-06T08:00:00Z', 120_000)).toContain('>03:00<');
  expect(render(null)).toContain('>--:--<');
});

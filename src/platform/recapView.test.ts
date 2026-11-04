// 0.3.0-beta.3 E7：记住的回看选择的解析——非法字段只换回那个字段的默认值并提示一次。
import { expect, it, vi } from 'vitest';
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
import { parseRecapView } from './recapView';
import { DEFAULT_RECAP_VIEW } from '../shared/recap';

it('missing file → defaults without a notice; missing fields are not an error', () => {
  expect(parseRecapView(null)).toEqual({ view: DEFAULT_RECAP_VIEW, corrupt: false });
  expect(parseRecapView({ dim: 'tag' })).toEqual({ view: { ...DEFAULT_RECAP_VIEW, dim: 'tag' }, corrupt: false });
});
it('a custom period keeps its dates; relative periods drop them', () => {
  expect(parseRecapView({ period: 'custom', from: '2026-10-20', to: '2026-11-04' }).view).toMatchObject({ period: 'custom', from: '2026-10-20', to: '2026-11-04' });
  expect(parseRecapView({ period: 'month', from: '2026-10-20', to: '2026-11-04' }).view).toMatchObject({ period: 'month', from: null, to: null });
});
it('invalid fields fall back one by one and mark the file as unreadable once', () => {
  const r = parseRecapView({ period: 'decade', dim: 'tag', includeIdle: 'yes', view: 'list' });
  expect(r).toEqual({ view: { ...DEFAULT_RECAP_VIEW, dim: 'tag', view: 'list' }, corrupt: true });
  expect(parseRecapView({ period: 'custom', from: '2026-02-30', to: '2026-03-01' })).toMatchObject({ view: { period: 'week', from: null, to: null }, corrupt: true });
  expect(parseRecapView([1, 2]).corrupt).toBe(true);
});

import { describe, it, expect } from 'vitest';
import { effective } from './effective';
import { activityDay, splitAtDays } from './day';
import type { Segment } from './segment';

const segment = (seq: number, start: string, end: string, card: string | null): Segment => ({
  id: crypto.randomUUID(), seq, started_at: start, ended_at: end, activity: card ? '学Python' : '厕所', project: '支线', card_id: card,
  kind: '普通', source: seq === 1 ? '手动' : '补记', resume_card_id: null,
});
describe('effective timeline', () => {
  it('A1: 60 minutes corrected by 20 minute restroom leaves 40', () => {
    const rows = effective([
      segment(1, '2026-10-26T10:00:00+08:00', '2026-10-26T11:00:00+08:00', 'a'),
      segment(2, '2026-10-26T10:20:00+08:00', '2026-10-26T10:40:00+08:00', null),
    ], '2026-10-26T12:00:00+08:00');
    expect(rows.filter(s => s.card_id === 'a').reduce((n, s) => n + Date.parse(s.ended_at!) - Date.parse(s.started_at), 0)).toBe(40 * 60_000);
    expect(rows).toHaveLength(3);
  });
  it('splits at the local 04:00 boundary without losing duration', () => {
    const start = new Date(2026, 9, 26, 3, 50).toISOString(), end = new Date(2026, 9, 26, 4, 10).toISOString();
    const parts = splitAtDays(start, end, 4);
    expect(parts.map(p => p.day)).toEqual(['2026-10-25', '2026-10-26']);
    expect(activityDay(start, 4)).toBe('2026-10-25');
    expect(parts.reduce((n, p) => n + Date.parse(p.end) - Date.parse(p.start), 0)).toBe(20 * 60_000);
  });
  it('rejects duplicate sequence rather than hiding data corruption', () => {
    const a = segment(1, '2026-10-26T10:00:00Z', '2026-10-26T11:00:00Z', 'a');
    expect(() => effective([a, a], a.ended_at!)).toThrow('Duplicate seq');
  });
});

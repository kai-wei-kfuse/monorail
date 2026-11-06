// Reproducible 50-item board projection measurement; no performance threshold is invented.
import { performance } from 'node:perf_hooks';
import { writeFileSync } from 'node:fs';
import { projectPlan } from '../../src/services/planProjection';
import { convert } from '../../src/domain/record/convert';
import { emptyPlan } from '../../src/domain/plan/plan';
import type { TimeEntry } from '../../src/domain/timeline/entry';

const at = '2026-11-06T09:00:00.000Z';
const cards = Array.from({ length: 50 }, (_, i) => ({
  ...convert({ id: `record-${i}`, text: `item-${i}`, kind: '待办', created_at: at, due_at: null,
    blocking: false, task_id: null, card_id: null, tags: [], attachments: [] }, i), id: `card-${i}`,
}));
const entries: TimeEntry[] = Array.from({ length: 2000 }, (_, i) => ({
  id: `entry-${i}`, started_at: new Date(Date.parse(at) - (2001 - i) * 60_000).toISOString(),
  ended_at: new Date(Date.parse(at) - (2000 - i) * 60_000).toISOString(),
  description: `item-${i % 50}`, project: '工作', tags: [], card_id: `card-${i % 50}`,
  kind: '普通', source: '计时', updated_at: at,
}));
const today = { ...emptyPlan('2026-11-06'), items: cards.map(card => ({
  card_id: card.id, priority: '普通' as const, today_minutes: null, added_at: at, carried: false,
})) };
const input = { today, tomorrow: emptyPlan('2026-11-07'), cards, tasks: [], entries, runningCard: null, boundaryHour: 4, at };
projectPlan(input);
const samples = Array.from({ length: 30 }, () => {
  const start = performance.now(); const result = projectPlan(input);
  if (result.today.rows.length !== 50) throw new Error('Benchmark fixture did not produce 50 rows');
  return performance.now() - start;
}).sort((a, b) => a - b);
const result = { node: process.version, boardItems: cards.length, entries: entries.length, samples: samples.length,
  medianMs: samples[15], p95Ms: samples[28], maxMs: samples.at(-1), scope: 'pure projection only, excludes transaction IO and native rendering' };
writeFileSync('evidence/release-0.3.1/benchmark-plan.json', JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));

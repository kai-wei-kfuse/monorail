import { vi } from 'vitest';
import { MemoryFs } from '../data/memoryFs';
import { createRepos } from '../data/repos';
import { defaults } from '../shared/settings';
import { convert } from '../domain/record/convert';
import type { Card } from '../domain/card/card';
import type { Project } from '../domain/project/project';
import { createContext, run } from './commit';
import type { Snapshot } from './commit';
import type { ReminderPlan } from '../domain/reminders';

export const at = (minute = 0) => new Date(2026, 9, 27, 10, minute).toISOString();
export function fixture() {
  let now = at();
  const settings = structuredClone(defaults);
  settings.lists.quickActivities = [{ id: 'wc', name: '厕所', category: '生活' }];
  const publish = vi.fn<(snapshot: Snapshot) => void>();
  const update = vi.fn<(plans: ReminderPlan[]) => Promise<void>>(async () => {}), random = vi.fn(() => 0);
  const repos = createRepos(new MemoryFs());
  const ctx = createContext({ repos, settings, id: () => crypto.randomUUID(), now: () => now,
    publish, log: async () => {}, reminders: { update }, random });
  return { ctx, publish, update, random, clock: (value: string) => { now = value; },
    home: () => publish.mock.calls.at(-1)![0].home };
}
export type Fixture = ReturnType<typeof fixture>;
export function card(id: string, fields: Partial<Card> = {}): Card {
  return { ...convert({ id: crypto.randomUUID(), text: id, kind: '待办', created_at: at(), due_at: null,
    blocking: false, project_id: null, card_id: null, tags: [], attachments: [] }, 1), id, ...fields };
}
export const project = (id: string, slot: Project['slot'] = '主线', slot_index = 1): Project =>
  ({ id, name: id, slot, slot_index, status: '进行中', created_at: at(), bet_ends_at: null });
export async function seed(f: Fixture, cards: Card[], projects: Project[] = []) {
  await f.ctx.repos.transact(crypto.randomUUID(), await Promise.all([
    ...cards.map(value => f.ctx.repos.cards.write(value, null)),
    ...projects.map(value => f.ctx.repos.projects.write(value, null)),
  ]));
  await run(f.ctx, async tx => { tx.state.current_card = cards[0]?.id ?? null; tx.state.home_mode = cards.length ? 'task' : 'guide'; });
}
export const getCard = async (f: Fixture, id: string) => (await f.ctx.repos.cards.get(id))!.value;
export const segments = (f: Fixture) => f.ctx.repos.times.snapshot();
export const open = (f: Fixture) => segments(f).find(segment => segment.ended_at === null)!;

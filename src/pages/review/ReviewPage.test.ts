import { Children, isValidElement, useState } from 'react';
import type { ReactElement } from 'react';
import type * as React from 'react';
import { expect, it, vi } from 'vitest';
import { ReviewPage } from './ReviewPage';
import type { ReviewActions, ReviewData } from './ReviewPage';
import { SwitchMain } from './SwitchMain';

vi.mock('react', async importOriginal => ({ ...await importOriginal<typeof React>(), useState: vi.fn() }));

it('switching main selects the reviewed project by id when two mains have the same name', () => {
  vi.mocked(useState).mockReturnValueOnce([true, vi.fn()]);
  const actions = Object.fromEntries(['goto', 'addIdea', 'duel', 'takeCold', 'skipCold', 'continueBet', 'switchMain', 'finish']
    .map(key => [key, vi.fn()])) as unknown as ReviewActions;
  const data: ReviewData = {
    period: '2026-W44', step: 'bet', done: ['recap', 'newIdeas', 'arena', 'coldPick'], betDue: true,
    recap: { completed: [], totals: [], notes: [] }, addedIdeas: [], duel: null, cold: { offered: [], poolFree: 10 },
    bet: { projectId: 'second', project: '同名主线', betEndsAt: '2026-10-27T00:00:00Z', betWeeks: 4 },
    backpack: { inBackpack: [{ id: 'first', name: '同名主线', slot: '主线' }, { id: 'second', name: '同名主线', slot: '主线' }], sideFree: true },
  };
  const page = ReviewPage({ data, actions });
  const dialog = Children.toArray(page.props.children).find(child => isValidElement(child) && child.type === SwitchMain) as ReactElement<{ current: { id: string } }>;
  expect(dialog.props.current.id).toBe('second');
});

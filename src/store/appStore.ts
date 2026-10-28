import { createStore } from 'zustand/vanilla';
import type { Card } from '../domain/card/card';
import type { TimeEntry } from '../domain/timeline/entry';
import { initialHome } from './homeSlice';
import type { HomeSlice } from './homeSlice';
import type { Notice } from '../shared/notices';
import { appendNotices } from './noticeSlice';
import { initialBackpack } from './backpackSlice';
import type { BackpackSlice } from './backpackSlice';
import type { ReviewSlice } from './reviewSlice';
import { defaults } from '../shared/settings';
import type { Settings } from '../shared/settings';

export interface Projection { cards: Card[]; currentCard: string | null; entries: TimeEntry[]; home: HomeSlice; backpack: BackpackSlice; review: ReviewSlice; settings: Settings; notices: Notice[]; error: string | null; ready: boolean }
export const appStore = createStore<Projection>(() => ({ cards: [], currentCard: null, entries: [], home: initialHome, backpack: initialBackpack, review: null, settings: structuredClone(defaults), notices: [], error: null, ready: false }));
export function publishProjection(value: { cards: Card[]; entries: TimeEntry[]; state: { current_card: string | null }; home: HomeSlice; backpack: BackpackSlice; review: ReviewSlice; settings: Settings; notices: Notice[] }) {
  appStore.setState(previous => ({ cards: value.cards, entries: value.entries, currentCard: value.state.current_card,
    home: value.home, backpack: value.backpack, review: value.review, settings: value.settings, notices: appendNotices(previous.notices, value.notices), ready: true }));
}
export function dismissNotice(id: string) { appStore.setState(previous => ({ notices: previous.notices.filter(notice => notice.id !== id) })); }

import { createStore } from 'zustand/vanilla';
import type { Card } from '../domain/card/card';
import type { Segment } from '../domain/timeline/segment';
import { initialHome } from './homeSlice';
import type { HomeSlice } from './homeSlice';
import type { Notice } from '../shared/notices';
import { appendNotices } from './noticeSlice';

export interface Projection { cards: Card[]; currentCard: string | null; segments: Segment[]; home: HomeSlice; notices: Notice[]; error: string | null; ready: boolean }
export const appStore = createStore<Projection>(() => ({ cards: [], currentCard: null, segments: [], home: initialHome, notices: [], error: null, ready: false }));
export function publishProjection(value: { cards: Card[]; segments: Segment[]; state: { current_card: string | null }; home: HomeSlice; notices: Notice[] }) {
  appStore.setState(previous => ({ cards: value.cards, segments: value.segments, currentCard: value.state.current_card,
    home: value.home, notices: appendNotices(previous.notices, value.notices), ready: true }));
}
export function dismissNotice(id: string) { appStore.setState(previous => ({ notices: previous.notices.filter(notice => notice.id !== id) })); }

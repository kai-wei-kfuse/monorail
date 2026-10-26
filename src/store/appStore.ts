import { createStore } from 'zustand/vanilla';
import type { Card } from '../domain/card/card';
import type { Segment } from '../domain/timeline/segment';

export interface Projection { cards: Card[]; currentCard: string | null; segments: Segment[]; error: string | null; ready: boolean }
export const appStore = createStore<Projection>(() => ({ cards: [], currentCard: null, segments: [], error: null, ready: false }));

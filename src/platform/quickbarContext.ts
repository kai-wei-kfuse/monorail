import { emit, emitTo, listen } from '@tauri-apps/api/event';

/**
 * The quick bar has no read access to the data folder; the main window pushes what it needs.
 * It asks once on start (`quickbar-ready`) and receives a fresh copy after every commit.
 */
export interface QuickbarContext { projects: { id: string; name: string }[]; accent: string }

export const pushQuickbarContext = (value: QuickbarContext) => emitTo('quickbar', 'quickbar-context', value);
export const onQuickbarReady = (handler: () => void) => listen('quickbar-ready', () => handler());
export async function subscribeQuickbarContext(handler: (value: QuickbarContext) => void) {
  const off = await listen<QuickbarContext>('quickbar-context', event => handler(event.payload));
  await emit('quickbar-ready');
  return off;
}

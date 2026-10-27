import type { Notice } from '../shared/notices';
export type { Notice, NoticeKind } from '../shared/notices';
export interface NoticeSlice { notices: Notice[] }
export const initialNotices: NoticeSlice = { notices: [] };
export function appendNotices(current: Notice[], next: Notice[]): Notice[] {
  const ids = new Set(current.map(notice => notice.id));
  return [...current, ...next.filter(notice => { if (ids.has(notice.id)) return false; ids.add(notice.id); return true; })];
}

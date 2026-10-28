export interface HomeCard {
  id: string; slotNo: string; slotOf: string; task: string;
  type: '结果卡' | '时间盒卡'; goalMinutes: number | null; content: string; progressNote: string;
  status: '待做' | '进行中'; shrink: 'ok' | 'max' | 'locked';
}
export interface HomeSlice {
  mode: 'blank' | 'task' | 'guide' | 'rest' | 'review';
  entry: { id: string; description: string; project: string; tags: string[]; startedAt: string; cardId: string | null; paused: boolean; kind: '普通' | '插入' | '暂停' } | null;
  pending: { id: string; startedAt: string } | null;
  resumeDescription: string | null;
  knownTags: string[];
  guideKind: 'firstTask' | 'setMain' | 'splitMain' | 'allDone';
  card: HomeCard | null; closedEffectiveMs: number; currentSegStartedAt: string | null;
  awayActivity: string | null; baseline: { main: boolean | null; side: boolean };
  noMainHint: boolean; rest: { suggestion: string | null } | null;
  review: { period: string; resumeStep: string; betDue: boolean } | null;
  activity: { kind: 'idle' | 'focus' | 'away'; label: string; startedAt: string | null };
  dataVersion: number;
}
export const initialHome: HomeSlice = {
  mode: 'blank', entry: null, pending: null, resumeDescription: null, knownTags: [], guideKind: 'firstTask', card: null, closedEffectiveMs: 0, currentSegStartedAt: null,
  awayActivity: null, baseline: { main: null, side: false }, noMainHint: false, rest: null, review: null,
  activity: { kind: 'idle', label: '', startedAt: null }, dataVersion: 0,
};

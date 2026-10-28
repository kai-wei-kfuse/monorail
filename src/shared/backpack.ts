export interface CardFields {
  content: string; type: '结果卡' | '时间盒卡'; timeboxMinutes: number | null;
  blocking: boolean; dueAt: string | null; noShrink: boolean; projectId: string | null;
}
export type BackpackSlot = '主线' | '支线';
export interface MakeRoom { id: string; action: '冷藏' | '放弃' }
export interface ProjectDraft { name: string; slot: BackpackSlot | '不在背包'; makeRoom: MakeRoom | null }
/** 不属于任何项目的卡按支线算，界面上也叫「支线」。name 是项目名，slot 是标签条上的格号，
 * group 用在背包队列里（和支线项目区分），option 用在项目下拉框里。以后再改名只改这里。 */
export const LOOSE = { name: '支线', slot: '支', group: '支线 · 未归项目', option: '支线（不属于项目）' } as const;

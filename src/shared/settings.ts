export interface QuickActivity { id: string; name: string; category: string }
export interface RestItem { id: string; name: string }
export interface Settings {
  dayBoundaryHour: number;
  deadlineLeadMinutes: number;
  longActivityMinutes: number;
  lists: { quickActivities: QuickActivity[]; restPool: RestItem[]; idleName: string };
}

export const defaults: Settings = {
  dayBoundaryHour: 4, deadlineLeadMinutes: 60, longActivityMinutes: 240,
  lists: { quickActivities: [], restPool: [], idleName: '待机' },
};

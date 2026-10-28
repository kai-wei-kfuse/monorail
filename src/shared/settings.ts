export interface QuickActivity { id: string; name: string; project: string; tags: string[]; mode: '切换' | '插入'; place: '计时条' | '弹层' }
export interface RestItem { id: string; name: string }
export const settingDefinitions = {
  mainTasks: { type: 'number', default: 1, min: 1, max: 3, step: 1, unit: 'slots' },
  sideTasks: { type: 'number', default: 10, min: 1, max: 30, step: 1, unit: 'slots' },
  mainItems: { type: 'number', default: 5, min: 1, max: 10, step: 1, unit: 'items' },
  homeLayout: { type: 'enum', default: 'split', options: ['split', 'fused'], unit: 'layout' },
  // Exact minute arithmetic uses JavaScript safe integers; no product-specific upper cap is imposed.
  calendarSnapMinutes: { type: 'number', default: 5, min: 1, max: Number.MAX_SAFE_INTEGER, step: 1, unit: 'minutes' },
  calendarShowIdle: { type: 'boolean', default: true, unit: 'boolean' },
  betWeeks: { type: 'number', default: 4, min: 1, max: 12, step: 1, unit: 'weeks' },
  dueSoonHours: { type: 'number', default: 24, min: 1, max: 168, step: 1, unit: 'hours' },
  timeboxDefaultMinutes: { type: 'number', default: 60, min: 5, max: 240, step: 5, unit: 'minutes' },
  shrinkMaxLevel: { type: 'number', default: 2, min: 1, max: 4, step: 1, unit: 'levels' },
  refusalThreshold: { type: 'number', default: 4, min: 2, max: 10, step: 1, unit: 'times' },
  refusalWindowMinutes: { type: 'number', default: 30, min: 10, max: 120, step: 1, unit: 'minutes' },
  refusalResetMinutes: { type: 'number', default: 60, min: 15, max: 240, step: 1, unit: 'minutes' },
  inputHintWindowMinutes: { type: 'number', default: 30, min: 10, max: 120, step: 1, unit: 'minutes' },
  skipSignalCount: { type: 'number', default: 3, min: 2, max: 10, step: 1, unit: 'times' },
  subconsciousCount: { type: 'number', default: 3, min: 2, max: 10, step: 1, unit: 'times' },
  ideaPoolLimit: { type: 'number', default: 10, min: 3, max: 50, step: 1, unit: 'items' },
  ideaExpireDays: { type: 'number', default: 60, min: 7, max: 365, step: 1, unit: 'days' },
  reviewWeekday: { type: 'number', default: 7, min: 1, max: 7, step: 1, unit: 'iso-weekday' },
  dayBoundaryHour: { type: 'number', default: 4, min: 0, max: 8, step: 1, unit: 'hour' },
  longActivityMinutes: { type: 'number', default: 240, min: 30, max: 720, step: 30, unit: 'minutes' },
  deadlineLeadMinutes: { type: 'number', default: 60, min: 5, max: 1440, step: 1, unit: 'minutes' },
  offlineAskMinMinutes: { type: 'number', default: 5, min: 1, max: 60, step: 1, unit: 'minutes' },
  accent: { type: 'enum', default: '#fffa00', options: ['#fffa00', '#00f5a0', '#20b8ff', '#ff7a1a'], unit: 'color' },
  titleScale: { type: 'number', default: 65, min: 50, max: 100, step: 1, unit: '%' },
  topoMode: { type: 'enum', default: 'dynamic', options: ['dynamic', 'static', 'off'], unit: 'mode' },
  topoDepth: { type: 'number', default: 60, min: 0, max: 100, step: 1, unit: '%' },
  motion: { type: 'enum', default: 'full', options: ['full', 'reduced', 'off'], unit: 'mode' },
  quickbarHotkey: { type: 'string', default: 'Ctrl+Alt+Shift+R', unit: 'shortcut' },
  mainHotkey: { type: 'string', default: 'Ctrl+Alt+Shift+M', unit: 'shortcut' },
  autostart: { type: 'boolean', default: true, unit: 'boolean' },
  alwaysOnTop: { type: 'boolean', default: false, unit: 'boolean' },
} as const;

export type SettingKey = keyof typeof settingDefinitions;
type Value<D> = D extends { type: 'number' } ? number : D extends { type: 'boolean' } ? boolean : D extends { options: readonly (infer O)[] } ? O : string;
export type SettingValues = { [K in SettingKey]: Value<(typeof settingDefinitions)[K]> };
export type SettingEntry = { [K in SettingKey]: (typeof settingDefinitions)[K] & { key: K } }[SettingKey];
export const settingEntries = Object.entries(settingDefinitions).map(([key, definition]) => ({ ...definition, key })) as SettingEntry[];
export type Settings = SettingValues & {
  schemaVersion: 2;
  lists: { presets: QuickActivity[]; projects: { name: string; color: string }[]; tags: string[]; restPool: RestItem[]; idleName: string };
};
export const defaults: Settings = {
  ...Object.fromEntries(settingEntries.map(entry => [entry.key, entry.default])) as SettingValues,
  schemaVersion: 2, lists: { presets: [], projects: [], tags: [], restPool: [], idleName: '待机' },
};

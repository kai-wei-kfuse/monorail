// 回看页记住的选择（0.3.0-beta.3 E7 第 4 条）：Rust 命令 read_recap_view / write_recap_view 存在应用配置目录的 recap-view.json。
// 字段在这里校验：哪个字段非法就只把那个字段换回默认值，并告诉回看页提示一次。
// 不在 Tauri 里（gallery 预览）时用 localStorage，预览照样能记住。
import { invoke } from '@tauri-apps/api/core';
import { z } from 'zod';
import { DEFAULT_RECAP_VIEW, RECAP_DIMENSIONS, RECAP_PERIODS } from '../shared/recap';
import type { RecapViewState } from '../shared/recap';

export interface RecapViewLoad { view: RecapViewState; corrupt: boolean }

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().startsWith(v));
const fields = {
  period: z.enum(RECAP_PERIODS.map(p => p.id) as [RecapViewState['period'], ...RecapViewState['period'][]]),
  from: day.nullable(), to: day.nullable(),
  dim: z.enum(RECAP_DIMENSIONS.map(d => d.id) as [RecapViewState['dim'], ...RecapViewState['dim'][]]),
  includeIdle: z.boolean(),
  view: z.enum(['card', 'list']),
} satisfies { [K in keyof RecapViewState]: z.ZodType<RecapViewState[K]> };

/** 逐个字段校验；缺字段用默认值不算坏（以后加字段时旧文件照常读），取值非法才算坏。 */
export function parseRecapView(raw: unknown): RecapViewLoad {
  if (raw === null || raw === undefined) return { view: { ...DEFAULT_RECAP_VIEW }, corrupt: false };
  if (typeof raw !== 'object' || Array.isArray(raw)) return { view: { ...DEFAULT_RECAP_VIEW }, corrupt: true };
  const input = raw as Record<string, unknown>, view = { ...DEFAULT_RECAP_VIEW } as Record<string, unknown>;
  let corrupt = false;
  for (const [key, schema] of Object.entries(fields)) {
    if (!(key in input)) continue;
    const parsed = (schema as z.ZodType).safeParse(input[key]);
    if (parsed.success) view[key] = parsed.data; else corrupt = true;
  }
  const out = view as unknown as RecapViewState;
  // 自定义周期缺一端日期时没法恢复，退回默认周期
  if (out.period === 'custom' && (!out.from || !out.to)) { out.period = DEFAULT_RECAP_VIEW.period; out.from = null; out.to = null; corrupt = true; }
  if (out.period !== 'custom') { out.from = null; out.to = null; }
  return { view: out, corrupt };
}

const KEY = 'monorail.recap-view';
const inTauri = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export interface RecapViewPort { read(): Promise<RecapViewLoad>; write(view: RecapViewState): Promise<void> }

export const recapViewStore: RecapViewPort = {
  async read() {
    if (!inTauri()) {
      let raw: unknown = null;
      try { const text = window.localStorage.getItem(KEY); raw = text === null ? null : JSON.parse(text); } catch { return { view: { ...DEFAULT_RECAP_VIEW }, corrupt: true }; }
      return parseRecapView(raw);
    }
    const res = await invoke<{ value: unknown; corrupt: boolean }>('read_recap_view');
    const parsed = parseRecapView(res.value);
    return { view: parsed.view, corrupt: res.corrupt || parsed.corrupt };
  },
  async write(view) {
    if (!inTauri()) { window.localStorage.setItem(KEY, JSON.stringify(view)); return; }
    await invoke('write_recap_view', { value: view });
  },
};

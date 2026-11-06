// 计时条自动完成的数据来源（收藏、待做的卡、最近的记录），主窗口计时条和小窗共用（0.3.0-beta.4 D1）。
// 筛选与条数规则在 pages/home/suggestions.ts；这里只按同样的口径取数据。纯函数。

import { NOT_RECENT } from '../shared/suggest';
import type { SuggestData } from '../shared/suggest';

/** 去掉 [词] 标记（与 ui/marks 的 plainText 同一规则：没配对的方括号原样保留）。 */
const plain = (content: string) => content.replace(/\[([^\]\n]+)\]/g, '$1');

interface Source {
  presets: readonly { id: string; name: string; project: string; tags: string[]; place: string }[];
  cards: readonly { id: string; content: string; status: string; task_id: string | null }[];
  tasks: readonly { id: string; slot: string }[];
  entries: readonly { id: string; description: string; project: string; tags: string[]; started_at: string }[];
  /** 任务模式（设置 02）：关掉时不列卡 */
  taskMode?: boolean;
}

/**
 * recentLimit：给出时先按描述去重、去掉系统项目，再截到这么多条（小窗每秒心跳都要发，不发一年的全部条目）；
 * 不给时原样按开始时间新到旧全给（主窗口），由 suggestions() 去重和截 5 条。
 */
/** 任务模式关掉时不列卡（G7 审核 S3，ADR 0021 第 10 条） */
export function suggestSource({ presets, cards, tasks, entries, taskMode = true }: Source, recentLimit?: number): SuggestData {
  const track = (taskId: string | null) => tasks.find(t => t.id === taskId)?.slot === '主线' ? '主线' as const : '支线' as const;
  let recent = [...entries].sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at))
    .map(e => ({ id: e.id, description: e.description, project: e.project, tags: [...e.tags] }));
  if (recentLimit !== undefined) {
    const seen = new Set<string>();
    recent = recent.filter(e => !NOT_RECENT.has(e.project) && !seen.has(e.description) && seen.add(e.description)).slice(0, recentLimit);
  }
  return {
    favorites: presets.filter(p => p.place === '计时条').map(p => ({ id: p.id, name: p.name, project: p.project, tags: [...p.tags] })),
    cards: taskMode ? cards.filter(c => c.status === '待做').map(c => ({ id: c.id, content: plain(c.content), track: track(c.task_id) })) : [],
    recent,
  };
}

// 分开布局的卡区跟着计时条走（原型说明「分开布局」，stage.js 的 HomePage）。
import type { TimerView } from './TimerBar';

/**
 * 卡区显示什么：
 * - 计时条里在写字，或者正在计一件自己写的事（不是卡）：显示这件事（自由记录卡），有卡也盖过去；
 * - 否则有卡就显示卡。做卡时插入了快捷活动，卡还是进行中，照样显示卡（状态写离开中）；
 * - 没卡时，计时条上有事（在计、待确认、暂停中）就显示它；
 * - 都没有：none，由首页按 mode 显示空卡、引导卡或回顾卡。
 */
export function cardArea(draft: string | null, view: Pick<TimerView, 'entry' | 'idle' | 'pending' | 'paused'>, cardStatus: '待做' | '进行中' | null): 'card' | 'free' | 'none' {
  const running = view.entry && !view.idle ? view.entry : null;
  const mirror = !!draft?.trim();
  const free = !!running && !view.pending && !running.cardId && cardStatus !== '进行中';
  if (cardStatus && !mirror && !free) return 'card';
  if (mirror || running || view.pending || view.paused) return 'free';
  return 'none';
}

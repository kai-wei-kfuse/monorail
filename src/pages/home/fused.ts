// 融合布局大卡显示什么（原型 stage.js 的 FusedCard）。
import type { ReadoutTarget } from './TimeField';
import type { TimerView } from './TimerBar';

export interface FusedState {
  /** 标题区：卡的标题，还是输入框。 */
  show: 'card' | 'input';
  /** 显示卡时：计时在这张卡上；卡进行中但暂停了；卡进行中但插了快捷活动（离开中）。 */
  onCard: boolean; paused: boolean; away: boolean;
  /** 抽到的卡待开始时，待确认的这段算在卡的读数上。 */
  pendingOnCard: boolean;
  /** 点读数改的是哪一条；null 就不能点。 */
  target: ReadoutTarget | null;
}

/**
 * 没卡、点了「写别的」（write），或正在计一件自己写的事而卡还没开始（比如刷新后待确认丢了）：标题区是输入框；否则显示卡。
 * 读数：待确认时改起点；显示卡且计时在卡上，改这张卡的「已用」；输入框时改正在计的这一条；暂停中、离开中、待机都不能点。
 */
export function fusedState(view: Pick<TimerView, 'entry' | 'idle' | 'pending' | 'paused'>, card: { id: string; status: '待做' | '进行中' } | null, write: boolean): FusedState {
  const running = view.entry && !view.idle ? view.entry : null;
  const free = !!running && !view.pending && !running.cardId && card?.status !== '进行中';
  const show = !card || write || free ? 'input' : 'card';
  const onCard = show === 'card' && running?.cardId === card!.id;
  const doing = show === 'card' && card!.status === '进行中' && !onCard;
  const paused = doing && !running && view.paused !== null, away = doing && !!running && running.kind === '插入';
  const target: ReadoutTarget | null = view.pending ? { mode: 'pending', id: view.pending.id }
    : onCard ? { mode: 'ref', id: card!.id }
    : show === 'input' && running ? { mode: 'entry', id: running.id } : null;
  return { show, onCard, paused, away, pendingOnCard: show === 'card' && card!.status === '待做' && !!view.pending, target };
}

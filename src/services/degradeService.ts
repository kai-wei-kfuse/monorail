import { registerRefusal, finishRest } from '../domain/degrade/refusal';
import { restAnswer } from '../domain/degrade/signals';
import { releaseCard } from '../domain/card/transitions';
import type { Ctx, Transaction } from './commit';
import { run } from './commit';
import { switchInTx, idleTarget, backfillRangeInTx } from './timerService';

export async function registerRefusalInTx(tx: Transaction): Promise<void> {
  const result = registerRefusal(tx.state, tx.at, tx.settings);
  tx.state.refusals = result.state.refusals;
  if (result.action === 'none') return;
  if (result.action === 'input') {
    tx.notices.push({ id: tx.id(), kind: 'inputHint', data: {} });
    return;
  }
  const card = tx.cards.find(item => item.id === tx.state.current_card);
  if (card) tx.saveCard(releaseCard(card));
  const pool = tx.settings.lists.restPool;
  const suggestion = pool.length ? pool[Math.floor(tx.random() * pool.length)].name : null;
  tx.state.rest = { suggestion, started_at: tx.at };
  tx.state.home_mode = 'rest';
  await switchInTx(tx, tx.at, { activity: '休息', project: '休息', card_id: null, kind: '普通', resume_card_id: null }, { source: '自动' });
}

/** The answer changes the effective history through an appended overlay, never an edit. */
export const returnFromRest = (ctx: Ctx, answer: string, at: string) => run(ctx, async tx => {
  const rest = tx.state.rest;
  if (!rest) throw new Error('当前没有降级休息');
  if (Date.parse(at) < Date.parse(rest.started_at)) throw new Error('回来时间早于休息开始');
  await switchInTx(tx, at, idleTarget(tx));
  const activity = answer.trim();
  if (activity && Date.parse(at) > Date.parse(rest.started_at)) {
    await backfillRangeInTx(tx, at, { start: rest.started_at, end: at },
      { activity, project: '休息', card_id: null, kind: '普通', resume_card_id: null }, '自动');
  }
  const response = restAnswer(tx.state.rest_answers, answer, tx.settings.subconsciousCount);
  tx.state.rest_answers = response.counts;
  if (response.signal) tx.notices.push({ id: tx.id(), kind: 'subconscious', data: { answer: activity, count: response.counts[activity] } });
  const ended = finishRest(tx.state, at);
  tx.state.refusals = ended.refusals;
  tx.state.last_rest_ended_at = ended.last_rest_ended_at;
  tx.state.rest = null;
  tx.state.home_mode = tx.state.current_card ? 'task' : tx.state.review_period ? 'review' : 'guide';
}, at);

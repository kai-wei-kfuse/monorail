import { expect, it } from 'vitest';
import { at, card, fixture, getCard, open, seed, entries } from './serviceFixture';
import { start } from './cardService';
import { rest, resume } from './homeService';
import { newDay } from './dayChange';
import { run } from './commit';
import { startSystemInTx } from './tracking/api';

// 0.3.1 降级（已定 48、55，ADR 0021 第 7 条）：不再按拒绝次数进降级休息；主动休息是一条插入；0.3.0 遗留的 state.rest 在换日时处理一次

it('主动休息：插入一条休息，卡等着；回来接着计这张卡，不问刚才干了什么、不计数', async () => {
  const f = fixture(); await seed(f, [card('a')]); await start(f.ctx, 'a', at());
  f.clock(at(5)); await rest(f.ctx, at(5));
  expect(open(f)).toMatchObject({ description: '休息', project: '休息', kind: '插入' });
  expect((await getCard(f, 'a')).status).toBe('进行中');
  f.clock(at(15)); await resume(f.ctx, at(15));
  expect(open(f)).toMatchObject({ card_id: 'a', started_at: at(15) });
  expect(await f.ctx.repos.state.read()).toMatchObject({ rest: null, refusals: [], rest_answers: {} });
  expect(entries(f).filter(e => e.project === '休息')).toEqual([expect.objectContaining({ started_at: at(5), ended_at: at(15) })]);
});

it('0.3.0 遗留的降级休息：换日时处理一次，那段休息留着、转成待机、清空 rest，不问不计数', async () => {
  const f = fixture(); await seed(f, [card('a')]);
  await run(f.ctx, async tx => {
    startSystemInTx(tx, '休息'); tx.state.rest = { started_at: at(), suggestion: '走走' }; tx.state.home_mode = 'rest';
    tx.state.refusals = [at(), at(), at()];
  }, at(), { action: 'test.direct' });
  f.clock(at(30)); await newDay(f.ctx);
  // 0.3.0 降级休息时卡已放回待做；0.3.1 的 current_card 只能是 null 或进行中的卡（ADR 0021 第 2 条第 9 点），所以首页是空卡区
  expect(await f.ctx.repos.state.read()).toMatchObject({ rest: null, home_mode: 'blank', current_card: null });
  expect(open(f)).toMatchObject({ project: '待机', started_at: at(30) });
  expect(entries(f).filter(e => e.project === '休息')).toEqual([expect.objectContaining({ started_at: at(), ended_at: at(30) })]);
  // state.yaml 里 0.3.0 要求的字段照写原值（不再更新）
  expect((await f.ctx.repos.state.read()).refusals).toEqual([at(), at(), at()]);
});

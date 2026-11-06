import { expect, it } from 'vitest';
import { at, card, entries, fixture, open, seed, runTx } from './serviceFixture';
import { start } from './cardService';
import { commitReadout } from './homeService';

// 已定 23：卡上的大读数是今天在这张卡上的时间，总累计在标题下小字；点读数改的也是今天的（用户 2026-11-06）
const yesterday = (h: number) => new Date(2026, 9, 26, h, 0).toISOString();

async function workedYesterday() {
  const f = fixture(); await seed(f, [card('a', { type: '时间盒卡', timebox_minutes: 180 })]);
  // 前一天 20:00–21:00 做过这张卡（换日时间缺省 4 点，属于前一个活动日）
  await runTx(f.ctx, async tx => {
    const { manualInTx } = await import('./tracking/api');
    manualInTx(tx, { description: 'A', project: '未分类', tags: [], card_id: 'a' }, yesterday(20), yesterday(21), '手动');
  });
  await start(f.ctx, 'a', at()); f.clock(at(20));
  return f;
}

it('投影：今天已结束的段 + 今天这一段的起点；大读数只算今天，总累计含前一天', async () => {
  const f = await workedYesterday();
  const home = f.publish.mock.calls.at(-1)![0].home;
  expect(home.closedTodayMs).toBe(0);
  expect(home.todaySegStartedAt).toBe(at());
  // 界面按秒补：今天 = closedTodayMs + (现在 − todaySegStartedAt)；总累计 = closedEffectiveMs + (现在 − currentSegStartedAt)
  expect(home.closedTodayMs + Date.parse(at(20)) - Date.parse(home.todaySegStartedAt!)).toBe(20 * 60_000);
  expect(home.closedEffectiveMs + Date.parse(at(20)) - Date.parse(home.currentSegStartedAt!)).toBe(80 * 60_000);
});

it('点读数改今天的：写 40 分钟，开着这一段的起点往前拨到今天合计 40，前一天的记录不动', async () => {
  const f = await workedYesterday();
  await commitReadout(f.ctx, { target: { mode: 'refToday', id: 'a' }, at: at(20), milliseconds: 40 * 60_000 }, null);
  expect(open(f)).toMatchObject({ card_id: 'a', started_at: new Date(Date.parse(at(20)) - 40 * 60_000).toISOString() });
  expect(entries(f).find(e => e.started_at === yesterday(20))).toMatchObject({ ended_at: yesterday(21) });
  // 改总累计（ref）照旧：写 100 分钟 = 前一天 60 + 今天 40
  await commitReadout(f.ctx, { target: { mode: 'ref', id: 'a' }, at: at(20), milliseconds: 100 * 60_000 }, null);
  expect(open(f).started_at).toBe(new Date(Date.parse(at(20)) - 40 * 60_000).toISOString());
});

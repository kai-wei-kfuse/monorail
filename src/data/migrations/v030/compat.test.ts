import { describe, expect, it } from 'vitest';
import { cardSchema, entrySchema, settingsSchema } from './schemas';
import { stateSchema } from './state';
import { historyRecordSchema } from './history';
import { restoreParent, shrinkCard } from './shrink';
import { restoreParent as restoreParent031 } from '../../../domain/card/shrink';
import { abandonCard, completeCard, startCard } from '../../../domain/card/transitions';
import { defaults } from './settings';
import { assertEntries } from '../../../domain/timeline/entry';
import type { Card } from '../../../domain/card/card';
import type { TimeEntry } from '../../../domain/timeline/entry';

// ADR 0021 G1：0.3.1 写出的数据交给 0.3.0 的读法（本目录冻结自 tag v0.3.0）必须合法。
// 这里的 0.3.1 数据是按 ADR 0021 手写的形状；0.3.1 的实现改了以后，各阶段的单测负责产出同样的形状。

const at = '2026-11-06T09:00:00.000+08:00';
const baseCard: Card = {
  id: 'c-read-ch4', source_record_id: null, content: '读第 4 章并做完练习', created_at: '2026-11-01T10:00:00.000+08:00',
  due_at: null, blocking: false, task_id: 't-rust', project: '学习', tags: ['读书'], status: '进行中', type: '时间盒卡', order: 3,
  timebox_minutes: 60, no_shrink: false, shrunk_from: null, shrink_level: 0, continued_from: null, skip_count: 0,
  completed_at: null, completed_day: null, completed_track: null, progress_note: '', progress_noted_at: null,
};
/** ADR 0021 第 4 条：原卡改内容和时长、id 不变；rest 是新卡，shrunk_from 指向非「已缩小」的原卡，带可选 split_note。 */
const today: Card = { ...baseCard, content: '只读 4.1–4.3', timebox_minutes: 35, shrink_level: 1 };
const rest = { ...baseCard, id: 'c-read-ch4-rest', content: '4.4 以后和练习', status: '待做' as const, timebox_minutes: 25,
  order: 3.5, shrunk_from: today.id, shrink_level: 1, split_note: '读第 4 章并做完练习' };

const entry = (over: Partial<TimeEntry>): TimeEntry => ({ id: 'e', started_at: at, ended_at: null, description: '', project: '学习', tags: [],
  card_id: null, kind: '普通', source: '计时', updated_at: at, ...over });

describe('0.3.1 读 0.3.0 留下的「已缩小」链（ADR 0021 第 4 条：旧数据照 0.3.0 规则处理）', () => {
  const input = { at, content: '小一点', type: '结果卡' as const, minutes: null, order: 2, maxLevel: 4 };
  it('完成叶子只恢复直接父卡和它的进度', () => {
    const ab = shrinkCard(startCard(baseCard), { ...input, id: 'b' }), bc = shrinkCard(ab.child, { ...input, id: 'c' });
    const restoredB = restoreParent031(completeCard(bc.child, at, '2026-11-06', '支线', 'C进度'), bc.parent, 'C进度');
    expect(restoredB).toMatchObject({ status: '待做', progress_note: 'C进度' });
    expect(ab.parent.status).toBe('已缩小');
    expect(restoreParent031(completeCard(startCard(restoredB), at, '2026-11-06', '支线', 'B进度'), ab.parent, 'B进度')).toMatchObject({ status: '待做' });
  });
  it('不能 PASS 已缩小的祖先；PASS 叶子恢复父卡', () => {
    const ab = shrinkCard(baseCard, { ...input, id: 'b' }), bc = shrinkCard(ab.child, { ...input, id: 'c' });
    expect(() => abandonCard(ab.parent)).toThrow('先处理');
    expect(restoreParent031(abandonCard(bc.child), bc.parent, '').status).toBe('待做');
  });
});

describe('0.3.0 读 0.3.1 的数据（ADR 0021 G1 兼容锁定）', () => {
  it('拆分后的两张卡合法，split_note 原样保留', () => {
    expect(cardSchema.parse(today)).toMatchObject({ id: today.id, content: '只读 4.1–4.3', timebox_minutes: 35 });
    expect(cardSchema.parse(rest)).toMatchObject({ shrunk_from: today.id, split_note: '读第 4 章并做完练习' });
  });

  it('0.3.0 完成 rest 卡：父卡不是「已缩小」，restoreInTx 不改父卡、不抛错', () => {
    // 照抄 0.3.0 cardService.ts:22-27 的判断（restoreInTx 依赖 Transaction，不能拷进 data 层）
    const restoreInTx = (card: Card, parent: Card): Card | null => !card.shrunk_from ? null
      : parent.status === '已缩小' ? restoreParent(card, parent, card.progress_note) : null;
    expect(restoreInTx({ ...rest, status: '已完成' }, today)).toBeNull();
  });

  it('0.3.0 再缩小 rest 卡：子卡复制 split_note、父卡变「已缩小」（0.3.1 据此只在父卡不是已缩小时读 split_note）', () => {
    const { parent, child } = shrinkCard(rest as Card, { id: 'c-child', at, content: '只读 4.4', type: '结果卡', minutes: null, order: 4, maxLevel: 4 });
    expect(parent.status).toBe('已缩小');
    expect((child as Card & { split_note?: string }).split_note).toBe('读第 4 章并做完练习');
    expect(cardSchema.parse(child)).toMatchObject({ shrunk_from: rest.id });
  });

  it('插入的事暂停 =「待机 / 插入」，回到目标指向卡那一条：条目、状态都合法', () => {
    const cardRun = entry({ id: 'e-card', started_at: '2026-11-06T08:00:00.000+08:00', ended_at: '2026-11-06T08:30:00.000+08:00', card_id: baseCard.id, description: baseCard.content });
    const inserted = entry({ id: 'e-ins', started_at: '2026-11-06T08:30:00.000+08:00', ended_at: '2026-11-06T08:45:00.000+08:00', description: '回同事消息', project: '工作', kind: '插入' });
    const pausedInsert = entry({ id: 'e-idle', started_at: '2026-11-06T08:45:00.000+08:00', description: '待机', project: '待机', kind: '插入', source: '自动' });
    const entries = [cardRun, inserted, pausedInsert];
    for (const value of entries) expect(entrySchema.parse(value)).toEqual(value);
    expect(() => assertEntries(entries, at)).not.toThrow();
    const state = { schemaVersion: 2, current_card: baseCard.id, open_entry: pausedInsert.id, open_entry_day: '2026-11-06', seen: [],
      resume_entry_id: cardRun.id, pending_at: null, pending_id: null, home_mode: 'task', first_used_day: '2026-11-01', review_period: null,
      refusals: [], last_rest_ended_at: null, rest_answers: {}, rest: null };
    expect(stateSchema.parse(state)).toEqual(state);
  });

  it('宽松模式的离线结算：project 待机 + source 离线追问 合法', () => {
    const gap = entry({ id: 'e-off', started_at: '2026-11-06T01:00:00.000+08:00', ended_at: '2026-11-06T07:00:00.000+08:00', description: '待机', project: '待机', source: '离线追问' });
    expect(entrySchema.parse(gap)).toEqual(gap);
  });

  it('四个新设置键：0.3.0 解析通过并原样保留（写回时 SettingsRepo 合并原文件）', () => {
    const file = { ...defaults, insertBackPlace: 'bottom', taskMode: true, trackingMode: 'strict', idleAskMinutes: 30 };
    expect(settingsSchema.parse(file)).toMatchObject({ insertBackPlace: 'bottom', taskMode: true, trackingMode: 'strict', idleAskMinutes: 30 });
  });

  it('今日任务板的改动记成 card / state 类型的历史：0.3.0 读得出', () => {
    const record = { version: 1, id: 'h-1', at, day: '2026-11-06', action: 'plan.add', label: '排进今天', source: { kind: 'manual', via: 'main', page: '背包' },
      subject: { type: 'card', id: baseCard.id, text: baseCard.content, meta: '' },
      changes: [{ type: 'card', id: baseCard.id, name: baseCard.content, field: '今日任务板', before: null, after: '今天' },
        { type: 'card', id: baseCard.id, name: baseCard.content, field: '优先级', before: null, after: '高' }],
      effects: [{ type: 'state', id: 'state', name: '今天', field: '今天先不排', before: '是', after: '否' }] };
    expect(historyRecordSchema.parse(record)).toEqual(record);
  });
});

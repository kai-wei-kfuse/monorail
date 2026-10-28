import { describe, expect, it } from 'vitest';
import { suggestions } from './suggestions';

const data = {
  favorites: [{ id: 'f1', name: '学 408', project: '学习', tags: ['408'] }, { id: 'f2', name: '健身', project: '生活', tags: [] }],
  cards: ['写周报', '改简历', '学 Python', '读论文', '学 Rust'].map((content, i) => ({ id: `c${i}`, content, track: '支线' as const })),
  recent: [
    { id: 'e1', description: '学 408', project: '学习', tags: [] }, { id: 'e2', description: '待机', project: '待机', tags: [] },
    { id: 'e3', description: '学 408', project: '学习', tags: ['旧'] }, { id: 'e4', description: '午睡', project: '睡眠', tags: [] },
    ...['a', 'b', 'c', 'd', 'e'].map(d => ({ id: d, description: d, project: '工作', tags: [] })),
  ],
};

describe('suggestions', () => {
  it('没写字时全列，卡最多 4 张，最近的最多 5 条', () => {
    const r = suggestions('', data);
    expect(r.favorites).toHaveLength(2);
    expect(r.cards.map(c => c.content)).toEqual(['写周报', '改简历', '学 Python', '读论文']);
    expect(r.recent.map(e => e.id)).toEqual(['e1', 'a', 'b', 'c', 'd']);
  });
  it('按输入筛选，不分大小写', () => {
    const r = suggestions(' 学 ', data);
    expect(r.favorites.map(p => p.id)).toEqual(['f1']);
    expect(r.cards.map(c => c.content)).toEqual(['学 Python', '学 Rust']);
    expect(suggestions('python', data).cards.map(c => c.id)).toEqual(['c2']);
  });
  it('最近的记录：同名只留最新一条，不列待机、休息、睡眠', () => {
    const r = suggestions('学', data);
    expect(r.recent.map(e => e.id)).toEqual(['e1']);
    expect(suggestions('午睡', data).recent).toEqual([]);
  });
});

import { expect, it } from 'vitest';
import { createRecord, extractTags } from './record';

it('extracts distinct Unicode tags while leaving URL fragments and markdown headings alone', () => {
  expect(extractTags('学 #Python #中文 #Python\n#服务器-1 #a_b https://site/x#anchor\n## 标题')).toEqual(['Python', '中文', '服务器-1', 'a_b']);
});
it('initializes new ideas from creation time and preserves input fields and relative attachments', () => {
  const idea = createRecord({ id: crypto.randomUUID(), text: '试试 #服务器', kind: '想法', created_at: '2026-10-27T00:00:00Z',
    due_at: null, blocking: false, project_id: 'p', card_id: null, tags: ['stale'], needs: ' 空闲服务器 ', attachments: ['attachments/x.txt'] });
  expect(idea).toMatchObject({ pool: '活跃池', cold_since: null, last_touched_at: idea.created_at, tags: ['服务器'], needs: '空闲服务器', project_id: 'p', attachments: ['attachments/x.txt'] });
});

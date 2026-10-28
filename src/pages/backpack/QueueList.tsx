import { Button } from '../../ui/controls/Button';
import { Group } from '../../ui/layout/GroupTitle';
import { MarkedText } from '../../ui/marks/MarkedText';
import type { QueueCard, QueueGroup } from './types';
import './backpack.css';

const due = (iso: string) => { const d = new Date(iso); return `${d.getMonth() + 1}-${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')} 到期`; };

/** 任务队列：按项目分组（主线、支线，以及不属于项目的支线卡），每组按队列顺序列出卡。点「编辑」打开 CardEditor，「拆一张卡」新建。 */
export function QueueList({ groups, onEdit, onAdd }: { groups: QueueGroup[]; onEdit: (card: QueueCard) => void; onAdd: (taskId: string | null) => void }) {
  if (!groups.length) return <p className="ls-empty">背包里还没有项目，也没有不属于项目的卡。先建一个项目，再给它拆卡。</p>;
  return <>{groups.map(g => <Group key={g.taskId ?? 'loose'} cn={`${g.slotLabel} · ${g.name}`} en={`${g.cards.length} CARDS`}>
    {g.cards.length === 0 ? <p className="ls-empty">这里还没有卡。</p>
      : <ul className="ls">{g.cards.map(c => <li key={c.id} className="ls-item">
        <div>
          <b><MarkedText content={c.fields.content} /></b>
          <div className="ls-meta">
            {c.fields.blocking && <span className="tag-block">BLOCK</span>}
            {c.status === '进行中' && <span className="run">进行中</span>}
            <span>{c.fields.type === '时间盒卡' ? `时间盒 ${c.fields.timeboxMinutes} 分钟` : '结果卡'}</span>
            {c.fields.dueAt && <span>{due(c.fields.dueAt)}</span>}
            {c.shrinkLevel > 0 && <span>缩小第 {c.shrinkLevel} 级</span>}
            {c.skipCount > 0 && <span>跳过 {c.skipCount} 次</span>}
            {c.progressNote && <span>上次做到：{c.progressNote}</span>}
          </div>
        </div>
        <div className="ls-acts"><Button size="sm" onClick={() => onEdit(c)}>编辑</Button></div>
      </li>)}</ul>}
    <div className="bp-tools"><Button size="sm" onClick={() => onAdd(g.taskId)}>拆一张卡</Button></div>
  </Group>)}</>;
}

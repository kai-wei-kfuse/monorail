import { Segmented } from '../../ui/controls/Segmented';
import { DateTimeInput } from '../../ui/controls/DateTimeInput';
import { Dropdown } from '../../ui/controls/Dropdown';
import { TextInput } from '../../ui/controls/TextInput';

export type RecordKind = '想法' | '待办';
export interface DraftFields { kind: RecordKind; blocking: boolean; dueAt: string | null; projectId: string | null; needs: string }
export const EMPTY_FIELDS: DraftFields = { kind: '想法', blocking: false, dueAt: null, projectId: null, needs: '' };

/**
 * 记录条上可以顺手设置的字段，都可以不填。类型不选时默认是想法。
 * 阻塞、期限只对待办有意义；资源只对想法有意义；所属项目两种都可以。
 */
export function QuickBarFields({ value, onChange, projects }:
  { value: DraftFields; onChange: (next: DraftFields) => void; projects: { id: string; name: string }[] }) {
  const set = (patch: Partial<DraftFields>) => onChange({ ...value, ...patch });
  const todo = value.kind === '待办';
  return <div className="qb-fields">
    <Segmented label="类型" value={value.kind} onChange={kind => set({ kind })}
      options={[{ value: '想法', label: '想法' }, { value: '待办', label: '待办' }]} />
    {todo && <button type="button" className="qb-toggle" aria-pressed={value.blocking} title="这件事挡住了别的事，选卡时排最前"
      onClick={() => set({ blocking: !value.blocking })}>阻塞</button>}
    {todo && <DateTimeInput label="期限" value={value.dueAt} onChange={dueAt => set({ dueAt })} />}
    <Dropdown label="所属项目" value={value.projectId ?? ''} onChange={id => set({ projectId: id || null })}
      options={[{ value: '', label: todo ? '散件（不属于项目）' : '不属于项目' }, ...projects.map(p => ({ value: p.id, label: p.name }))]} />
    {!todo && <TextInput aria-label="需要的资源" placeholder="需要什么资源，例如空闲服务器" value={value.needs}
      onChange={e => set({ needs: e.target.value })} style={{ minWidth: 240 }} />}
  </div>;
}

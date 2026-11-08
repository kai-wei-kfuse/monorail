import { Segmented } from '../../ui/controls/Segmented';
import { DateTimeInput } from '../../ui/controls/DateTimeInput';
import { Dropdown } from '../../ui/controls/Dropdown';
import { TextInput } from '../../ui/controls/TextInput';
import { Keycap } from '../../ui/controls/Keycap';
import { LOOSE } from '../../shared/backpack';

export type RecordKind = '想法' | '待办';
export interface DraftFields {
  kind: RecordKind;
  blocking: boolean;
  dueAt: string | null;
  taskId: string | null;
  needs: string;
}
export const EMPTY_FIELDS: DraftFields = { kind: '想法', blocking: false, dueAt: null, taskId: null, needs: '' };

/**
 * 记录条上可以顺手设置的字段，都可以不填。类型不选时默认是想法。
 * 期限只对待办有意义；资源与详情开关只对想法有意义；所属项目两种都可以。
 */
export function QuickBarFields({
  value,
  onChange,
  tasks,
  detailOpen = false,
  hasDetailDraft = false,
  onToggleDetail,
  disabled = false,
}: {
  value: DraftFields;
  onChange: (next: DraftFields) => void;
  tasks: { id: string; name: string }[];
  detailOpen?: boolean;
  hasDetailDraft?: boolean;
  onToggleDetail?: () => void;
  disabled?: boolean;
}) {
  const set = (patch: Partial<DraftFields>) => onChange({ ...value, ...patch });
  const todo = value.kind === '待办';
  return (
    <div className="qb-fields" data-tauri-drag-region>
      <Segmented
        label="类型"
        value={value.kind}
        onChange={kind => !disabled && set({ kind })}
        options={[
          { value: '想法', label: '想法' },
          { value: '待办', label: '待办' },
        ]}
      />
      {todo && <DateTimeInput label="期限" inlineLabel value={value.dueAt} onChange={dueAt => !disabled && set({ dueAt })} />}
      <Dropdown
        label="所属项目"
        value={value.taskId ?? ''}
        onChange={id => !disabled && set({ taskId: id || null })}
        options={[{ value: '', label: todo ? LOOSE.option : '不属于项目' }, ...tasks.map(p => ({ value: p.id, label: p.name }))]}
      />
      {!todo && (
        <>
          <TextInput
            aria-label="需要的资源"
            placeholder="需要什么资源，例如空闲服务器"
            value={value.needs}
            disabled={disabled}
            onChange={e => set({ needs: e.target.value })}
            style={{ minWidth: 210 }}
          />
          {onToggleDetail && (
            <button
              type="button"
              className="qb-toggle"
              aria-pressed={detailOpen}
              data-has-draft={hasDetailDraft ? 'true' : undefined}
              disabled={disabled}
              onClick={onToggleDetail}
            >
              {detailOpen ? '－ 收起详情' : hasDetailDraft ? '＋ 写详情（已写）' : '＋ 写详情'}
            </button>
          )}
          <span className="qb-right-hint" data-tauri-drag-region>
            <Keycap keys="Shift+Enter" small /> 展开详情 · <Keycap keys="Ctrl+Enter" small /> 保存
          </span>
        </>
      )}
    </div>
  );
}

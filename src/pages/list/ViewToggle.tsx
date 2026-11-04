import { Segmented } from '../../ui/controls/Segmented';

export type ListView = 'entries' | 'history';
/** 列表页右上〔计时记录 | 操作历史〕（执行方案 E8c 第 2 条）。 */
export function ViewToggle({ value, onChange }: { value: ListView; onChange: (v: ListView) => void }) {
  return <Segmented<ListView> label="列表内容" value={value} onChange={onChange}
    options={[{ value: 'entries', label: '计时记录' }, { value: 'history', label: '操作历史' }]} />;
}

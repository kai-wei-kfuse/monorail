import { useState } from 'react';
import type { QuickActivity } from '../../shared/settings';
import { Button } from '../../ui/controls/Button';
import { ProjectPicker } from '../../ui/controls/ProjectPicker';
import type { ProjectOption } from '../../ui/controls/ProjectPicker';
import { Segmented } from '../../ui/controls/Segmented';
import { TagPicker } from '../../ui/controls/TagPicker';
import { TextInput } from '../../ui/controls/TextInput';
import './settings.css';

type Place = QuickActivity['place'];
const OTHER: Record<Place, { place: Place; cn: string }> = { 计时条: { place: '弹层', cn: '移到快捷活动' }, 弹层: { place: '计时条', cn: '移到收藏' } };
/** 收藏默认切换、记到未分类；快捷活动默认插入、记到生活（和临时活动一样）。 */
const FRESH: Record<Place, Pick<QuickActivity, 'project' | 'mode'>> = { 计时条: { project: '未分类', mode: '切换' }, 弹层: { project: '生活', mode: '插入' } };
/** 计时条下面的收藏行最多放 9 个（PresetRow）。 */
const FAV_ROW = 9;

/** 名称：边写边改只在本地，回车或点别处才交出去；清空了就不改，Esc 放弃。 */
function NameField({ value, onCommit }: { value: string; onCommit: (name: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => { const name = draft?.trim(); if (name && name !== value) onCommit(name); setDraft(null); };
  return <TextInput aria-label="名称" value={draft ?? value} onChange={e => setDraft(e.target.value)} onBlur={commit}
    onKeyDown={e => {
      if (e.nativeEvent.isComposing) return;
      if (e.key === 'Enter') e.currentTarget.blur();
      if (e.key === 'Escape') { setDraft(null); e.currentTarget.blur(); }
    }} />;
}

/**
 * 预设编辑器（设计文档「项目、标签、预设」）：只列出位置是 place 的那一组（收藏 = 计时条，快捷活动 = 弹层）。
 * 每项可以改名称、项目、标签、方式（切换 / 插入），排序，移到另一组，删除；最下面一行添加。
 * 每次改动都交出整份预设列表（另一组原样保留），由调用方保存。项目、标签可以在选择器里就地新建，交给 onCreateProject / onCreateTag 登记。
 */
export function PresetEditor({ presets, place, projects, knownTags, placeholder, onChange, onCreateProject, onCreateTag }:
  { presets: QuickActivity[]; place: Place; projects: ProjectOption[]; knownTags: string[]; placeholder: string;
    onChange: (presets: QuickActivity[]) => void; onCreateProject?: (name: string) => void; onCreateTag?: (tag: string) => void }) {
  const [draft, setDraft] = useState('');
  const mine = presets.filter(p => p.place === place);
  const set = (id: string, patch: Partial<QuickActivity>) => onChange(presets.map(p => (p.id === id ? { ...p, ...patch } : p)));
  // 在这一组里和前一项 / 后一项换位置，另一组的项不动
  const move = (i: number, d: number) => {
    const a = presets.indexOf(mine[i]), b = presets.indexOf(mine[i + d]), next = [...presets];
    [next[a], next[b]] = [next[b], next[a]];
    onChange(next);
  };
  // 移到另一组：排到那一组最后
  const relocate = (p: QuickActivity) => onChange([...presets.filter(x => x.id !== p.id), { ...p, place: OTHER[place].place }]);
  const add = () => {
    const name = draft.trim();
    if (!name) return;
    onChange([...presets, { id: crypto.randomUUID(), name, tags: [], place, ...FRESH[place] }]);
    setDraft('');
  };
  return <div className="le pe">
    {mine.length === 0 && <p className="ls-empty">还没有。软件不预置，用的时候自己加。</p>}
    {mine.map((p, i) => <div key={p.id} className="pe-row">
      <span className="le-no">{String(i + 1).padStart(2, '0')}</span>
      <NameField value={p.name} onCommit={name => set(p.id, { name })} />
      <ProjectPicker small id={`pe-${p.id}-project`} value={p.project} options={projects} onChange={project => set(p.id, { project })} onCreate={onCreateProject} />
      <TagPicker id={`pe-${p.id}-tags`} value={p.tags} options={knownTags} onChange={tags => set(p.id, { tags })} onCreate={onCreateTag} />
      <Segmented label="方式" value={p.mode} onChange={mode => set(p.id, { mode })}
        options={[{ value: '切换', label: '切换' }, { value: '插入', label: '插入' }]} />
      <span className="pe-acts">
        <Button size="sm" onClick={() => relocate(p)}>{OTHER[place].cn}</Button>
        <Button size="sm" disabled={i === 0} aria-label="上移" onClick={() => move(i, -1)}>↑</Button>
        <Button size="sm" disabled={i === mine.length - 1} aria-label="下移" onClick={() => move(i, 1)}>↓</Button>
        <Button size="sm" tone="danger" onClick={() => onChange(presets.filter(x => x.id !== p.id))}>删除</Button>
      </span>
    </div>)}
    {place === '计时条' && mine.length > FAV_ROW && <p className="ls-empty">计时条下面只放得下前 {FAV_ROW} 个，后面的在输入框的自动完成里还能选到。</p>}
    <div className="le-row le-add">
      <span className="le-no">＋</span>
      <TextInput aria-label="新加一项" placeholder={placeholder} value={draft} onChange={e => setDraft(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) add(); }} />
      <Button size="sm" tone="ink" disabled={!draft.trim()} onClick={add}>添加</Button>
    </div>
  </div>;
}

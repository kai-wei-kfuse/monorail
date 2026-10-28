import type { FormEvent } from 'react';
import { useState } from 'react';
import { parseEntryText } from '../../shared/tags';
import { ActionButton } from '../../ui/controls/Button';
import { ProjectPicker } from '../../ui/controls/ProjectPicker';
import type { ProjectOption } from '../../ui/controls/ProjectPicker';
import { TagPicker } from '../../ui/controls/TagPicker';
import { TextInput } from '../../ui/controls/TextInput';
import { manualRange } from './manualRange';
import { coverText } from './TimeField';
import type { Cover } from './TimeField';
import type { EntryValue } from './TimerBar';
import './timer.css';

const pad = (n: number) => String(n).padStart(2, '0');
const hm = (t: number) => { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const TIMES = [['start', 'START', '开始', '9:30'], ['end', 'END', '结束', '11'], ['dur', 'DURATION', '时长', '1h 30m']] as const;

/**
 * 计时条的「手动补录」（UI 规范 §11.1，方案 §7.2）：写一段做过的事，开始、结束、时长填两项。
 * 和已有记录重叠时两条共存（E1），下面一行先说会和哪些并排；overlaps 由接线按条目查。onAdd 交 ISO 时刻。
 */
export function ManualForm({ projects, knownTags, overlaps, onAdd, onCreateProject, onCreateTag }:
  { projects: ProjectOption[]; knownTags: string[]; overlaps: (start: string, end: string) => Cover[];
    onAdd: (value: EntryValue, start: string, end: string) => void; onCreateProject: (name: string) => void; onCreateTag: (tag: string) => void }) {
  const [f, setF] = useState({ text: '', project: '未分类', tags: [] as string[], start: '', end: '', dur: '' });
  const r = manualRange(f.start, f.end, f.dur, Date.now());
  const p = parseEntryText(f.text, projects.map(o => o.name));
  const hit = 'error' in r ? [] : overlaps(new Date(r.start).toISOString(), new Date(r.end).toISOString());
  const ok = !('error' in r) && !!p.description;

  function submit(e: FormEvent) {
    e.preventDefault();
    const range = manualRange(f.start, f.end, f.dur, Date.now());
    if ('error' in range || !p.description) return;
    onAdd({ description: p.description, project: p.project ?? f.project, tags: [...new Set([...p.tags, ...f.tags])] },
      new Date(range.start).toISOString(), new Date(range.end).toISOString());
    setF({ ...f, text: '', tags: [], start: '', end: '', dur: '' });
  }
  return <>
    <form className="tbar-row manual" onSubmit={submit}>
      <div className="tbar-tag" data-kind="manual"><span>LOG</span></div>
      <div className="tbar-group">
        <div className="tbar-input"><input id="m-text" aria-label="补一段做过的事" autoComplete="off" placeholder="补一段做过的事（可以写 #标签）"
          value={f.text} onChange={e => setF({ ...f, text: e.target.value })} /></div>
        <ProjectPicker id="m-project" value={f.project} options={projects} onChange={v => setF({ ...f, project: v })} onCreate={onCreateProject} />
        <TagPicker id="m-tags" value={f.tags} options={knownTags} onChange={v => setF({ ...f, tags: v })} onCreate={onCreateTag} />
      </div>
      <div className="m-times">
        {TIMES.map(([k, en, cn, ph]) => <label key={k}><span className="k">{en}<em>{cn}</em></span>
          <TextInput className="m-in" id={'m-' + k} placeholder={ph} autoComplete="off" value={f[k]} onChange={e => setF({ ...f, [k]: e.target.value })} /></label>)}
      </div>
      <div className="tbar-acts"><ActionButton type="submit" primary compact cn="添加" en="ADD" icon="plus" disabled={!ok} /></div>
    </form>
    <div className="tbar-sub">
      {'error' in r ? <span>{r.error}</span> : <span>将生成 <b>{hm(r.start)}–{hm(r.end)}</b>（{Math.round((r.end - r.start) / 60_000)} 分钟）</span>}
      {hit.length > 0 && <span className="tbar-note">会和这些同时存在，日历上并排显示：{coverText(hit)}</span>}
    </div>
  </>;
}

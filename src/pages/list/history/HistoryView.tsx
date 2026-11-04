import { Fragment, useEffect, useMemo, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import type { HistoryRecord } from '../../../shared/history';
import { HISTORY_RETENTION_DAYS } from '../../../shared/history';
import { PageFrame } from '../../../ui/layout/PageFrame';
import { TextInput } from '../../../ui/controls/TextInput';
import { Button } from '../../../ui/controls/Button';
import { HistoryRow } from '../../../widgets/history/HistoryRow';
import { AgentSelect } from '../../../widgets/history/AgentSelect';
import { agentOptions, dayLabel, filterRecords, groupByDay, kindOf, sourceCounts, weekday, WK_EN } from '../../../widgets/history/model';
import type { SourceFilter } from '../../../widgets/history/model';
import './historyView.css';

export interface HistoryData { records: HistoryRecord[]; bad: number; older: boolean }
/** 从设置 09 跳过来：切到「仅自动化」，展开并闪一下这一条。seq 变了就再来一次。 */
export interface HistoryFocus { id: string; seq: number }

const pad = (n: number) => String(n).padStart(2, '0');
const RETENTION = `保留最近 ${HISTORY_RETENTION_DAYS} 天，更早的记录自动清理（只清理操作历史，不动计时、卡片等业务数据）`;
const FILTERS: { value: SourceFilter; cn: string; en?: string }[] = [
  { value: 'all', cn: '全部' }, { value: 'auto', cn: '仅自动化', en: 'MCP · CLI' }, { value: 'manual', cn: '仅手动' }, { value: 'system', cn: '仅系统' }];

function SourceSeg({ value, counts, onChange }: { value: SourceFilter; counts: Record<SourceFilter, number>; onChange: (v: SourceFilter) => void }) {
  const onKey = (e: KeyboardEvent) => {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const i = FILTERS.findIndex(f => f.value === value);
    onChange(FILTERS[(i + step + FILTERS.length) % FILTERS.length].value);
  };
  return <div className="seg oh-seg" role="radiogroup" aria-label="来源" onKeyDown={onKey}>
    {FILTERS.map(f => <button key={f.value} type="button" role="radio" aria-checked={f.value === value} tabIndex={f.value === value ? 0 : -1}
      onClick={() => onChange(f.value)}>{f.cn}{f.en && <i>{f.en}</i>}<b>{counts[f.value]}</b></button>)}
  </div>;
}

/**
 * 列表页的「操作历史」（执行方案 E8c 第 2 条，界面照 history-prototype.html）：来源分段、仅自动化时的调用方下拉、搜索、
 * 按记录里的 day 分组、再往前 7 天、底部说明。data 为 null 是还在读。
 */
export function HistoryView({ data, error, days, today, toggle, focus, onMore, onLocate, onCopy }:
  { data: HistoryData | null; error?: string | null; days: number; today: string; toggle: ReactNode; focus?: HistoryFocus | null;
    onMore: () => void; onLocate: (r: HistoryRecord) => void; onCopy: (text: string) => void }) {
  const [kind, setKind] = useState<SourceFilter>('all'), [agent, setAgent] = useState('all'), [q, setQ] = useState('');
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set()), [flash, setFlash] = useState<string | null>(null);
  useEffect(() => {
    if (!focus) return;
    setKind('auto'); setAgent('all'); setQ(''); setFlash(focus.id);
    setOpen(prev => new Set(prev).add(focus.id));
  }, [focus?.id, focus?.seq]);
  // 跳过来的那一条读到以后滚到眼前
  const found = !!flash && !!data?.records.some(r => r.id === flash);
  useEffect(() => {
    if (!found) return;
    document.querySelector(`.oh-item[data-id="${CSS.escape(flash!)}"]`)?.scrollIntoView({ block: 'center' });
    const id = setTimeout(() => setFlash(null), 1600);
    return () => clearTimeout(id);
  }, [found, flash]);

  const records = useMemo(() => data?.records ?? [], [data]);
  const counts = sourceCounts(records), autos = records.filter(r => kindOf(r.source) === 'auto'), agents = agentOptions(autos);
  const agentValue = agent !== 'all' && agents.some(a => a.label === agent) ? agent : 'all';
  const list = filterRecords(records, { kind, agent: agentValue, q });
  const toggleRow = (id: string) => setOpen(prev => { const next = new Set(prev); if (!next.delete(id)) next.add(id); return next; });
  const pickKind = (v: SourceFilter) => { setKind(v); setAgent('all'); };
  const filtered = !!q.trim() || kind !== 'all';

  return <PageFrame no={pad(records.length)} en={`HISTORY · ${days} DAYS`} cn="列表" tools={toggle}
    desc="改动了数据的操作都记在这里：你在主窗口、小窗、快速记录条里做的，MCP / CLI 调用的，以及软件按规则自己做的（标「系统」，如每天切换活动日、电脑休眠后补记离线时段）。浏览、查询这类只读操作，以及失败或被拒绝的调用不记。一个动作一条，点开看改前改后和连带改动；右边的 ◎ 跳到对应的那一天或那张卡。">
    <div className="oh-bar">
      <span className="k">SOURCE<em>来源</em></span>
      <SourceSeg value={kind} counts={counts} onChange={pickKind} />
      {kind === 'auto' && agents.length > 0 && <AgentSelect options={agents} total={autos.length} value={agentValue} onChange={setAgent} />}
      <TextInput type="search" aria-label="搜索操作历史" placeholder="搜索：动作、内容、调用方、operation_id" value={q} onChange={e => setQ(e.target.value)} />
      <span className="oh-cnt"><b>{list.length}</b> 次改动 · 最近 {days} 天</span>
    </div>
    {error && <p className="ls-warn" role="alert">读取操作历史失败：{error}</p>}
    {data && data.bad > 0 && <p className="ls-warn">有 {data.bad} 条记录无法读取，已跳过。</p>}
    {!data && !error && <p className="ls-empty">正在读取…</p>}
    {data && !records.length && !data.older && <p className="ls-empty">还没有操作记录。从现在开始，改动数据的操作都会记在这里，包括你在日历、列表、首页里的手动操作和 MCP / CLI 的调用。</p>}
    {data && (records.length > 0 || data.older) && !list.length && <p className="ls-empty">最近 {days} 天没有{filtered ? '符合筛选的' : ''}操作。</p>}
    {groupByDay(list).map(g => {
      const c = sourceCounts(g.records), [, m, d] = g.day.split('-').map(Number);
      const parts = ([['manual', '手动'], ['auto', '自动化'], ['system', '系统']] as const).filter(([k]) => c[k]);
      return <section key={g.day} className="oh-day">
        <h3 className="lv-dayhead"><b>{dayLabel(g.day, today)}</b><span>{WK_EN[weekday(g.day)]} · {m}/{d}</span><i />
          <em>{parts.map(([k, cn], i) => <Fragment key={k}>{i > 0 && '　'}{cn} <strong>{c[k]}</strong></Fragment>)}</em></h3>
        {g.records.map(r => <HistoryRow key={r.id} record={r} open={open.has(r.id)} flash={flash === r.id} onToggle={() => toggleRow(r.id)}
          onLocate={() => onLocate(r)} onCopy={onCopy} />)}
      </section>;
    })}
    <div className="oh-foot">
      {data?.older && <Button onClick={onMore}>再往前 7 天</Button>}
      <p>只能查看，不能撤销。{RETENTION}。</p>
    </div>
  </PageFrame>;
}

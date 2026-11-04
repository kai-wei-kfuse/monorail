import type { KeyboardEvent, ReactNode } from 'react';
import type { HistoryRecord } from '../../shared/history';
import { Button } from '../../ui/controls/Button';
import {
  agentClass, agentLabel, agentOf, changeRows, cliCommand, clockParts, DETECTED_LABEL, detectionNote, isDelete, kindOf, locateLabel,
  locateOf, mergeNote, prettyParams, rowSummary, SRC_LABEL, TRIGGER_LABEL, viaLabel,
} from './model';
import type { ChangeRow } from './model';
import './history.css';

export const ChevIcon = () => <svg viewBox="0 0 10 10" aria-hidden="true"><path d="M3 1.5 6.5 5 3 8.5" fill="none" stroke="currentColor" strokeWidth="1.6" /></svg>;
const LocIcon = () => <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
  <circle cx="8" cy="8" r="1.6" fill="currentColor" /><path d="M8 1v3M8 12v3M1 8h3M12 8h3" stroke="currentColor" strokeWidth="1.5" /></svg>;

/** 来源徽标 + 小字：MCP / CLI 黑底黄字跟调用方，手动灰底跟窗口与页面，系统细框跟触发原因。 */
export function SourceFrom({ record }: { record: HistoryRecord }) {
  const s = record.source, kind = kindOf(s), agent = agentOf(s);
  if (kind === 'auto' && agent) {
    return <span className="oh-from"><span className="oh-src auto">{SRC_LABEL[s.kind]}</span>
      <span className={`oh-via oh-agent ${agentClass(agent)}`.trim()} title={agent.detected_by === 'none' ? '没有识别到调用方' : `识别方式：${DETECTED_LABEL[agent.detected_by]} · 对方自报`}>{agentLabel(agent)}</span></span>;
  }
  return <span className="oh-from"><span className={`oh-src ${kind === 'system' ? 'sys' : 'man'}`}>{SRC_LABEL[s.kind]}</span><span className="oh-via">{viaLabel(s)}</span></span>;
}
export function ActLabel({ record }: { record: HistoryRecord }) {
  return <span className={`oh-act${isDelete(record) ? ' del' : ''}`}>{record.label}{record.merged ? <small>×{record.merged}</small> : null}</span>;
}

function Table({ rows }: { rows: ChangeRow[] }) {
  return <div className="oh-tbl">{rows.map((r, i) => <Cells key={i} row={r} />)}</div>;
}
function Cells({ row }: { row: ChangeRow }) {
  return <>
    <span className="f">{row.field}</span>
    <span className={`b${row.before === null ? ' none' : ''}`}>{row.before ?? '—'}</span>
    <span className="ar">→</span>
    <span className={`a${row.after === null ? ' gone' : ''}`}>{row.after ?? '已删除'}</span>
  </>;
}
function Sec({ en, cn, children }: { en: string; cn: string; children: ReactNode }) {
  return <div className="oh-sec"><span className="k">{en}<em>{cn}</em></span>{children}</div>;
}

/** 展开的详情：为什么会改（系统）、改动、连带改动、调用（自动化）。 */
export function HistoryDetail({ record, onCopy }: { record: HistoryRecord; onCopy?: (text: string) => void }) {
  const s = record.source, agent = agentOf(s), note = mergeNote(record), cmd = cliCommand(record);
  const changes = changeRows(record.changes, record.subject), effects = changeRows(record.effects, record.subject);
  return <div className="oh-detail">
    {s.kind === 'system' && <Sec en="TRIGGER" cn="为什么会改"><p className="oh-why"><b>{TRIGGER_LABEL[s.trigger]}</b>{record.why ? ` · ${record.why}` : ''}</p></Sec>}
    {(changes.length > 0 || note) && <Sec en="CHANGES" cn="改动">
      {changes.length > 0 ? <Table rows={changes} /> : <p className="oh-note">改回了原值，没有净改动。</p>}
      {note && <p className="oh-note">{note}</p>}
    </Sec>}
    {effects.length > 0 && <Sec en="SIDE EFFECTS" cn="连带改动"><Table rows={effects} /></Sec>}
    {agent && <Sec en="CALL" cn="调用">
      <div className="oh-who"><span>调用方</span><b className={agent.detected_by === 'none' ? 'unk' : ''}>{agentLabel(agent)}</b>
        {agent.version && agent.name && <span className="num">{agent.version}</span>}
        {agent.detected_by !== 'none' && <span className="oh-tag">对方自报 · 未验证</span>}</div>
      <Detection agent={agent} />
      {cmd && <div className="oh-call oh-gap"><span>命令</span><code className="cmd">{cmd}</code></div>}
      {record.call && <>
        <div className="oh-call oh-gap"><span>方法</span><code>{record.call.method}</code><span>operation_id</span><code>{record.call.operation_id}</code>
          {onCopy && <Button size="sm" onClick={() => onCopy(record.call!.operation_id)}>复制 ID</Button>}</div>
        <details className="oh-raw"><summary>原始参数 JSON{record.call.truncated ? '（超过 8 KB，已截断）' : ''}</summary><pre>{prettyParams(record.call)}</pre></details>
      </>}
      {!record.call && <p className="oh-how">旧客户端没有带调用信息。</p>}
    </Sec>}
  </div>;
}
function Detection({ agent }: { agent: NonNullable<ReturnType<typeof agentOf>> }) {
  const n = detectionNote(agent);
  return <p className="oh-how">识别方式：{n.lead}{n.code && <code>{n.code}</code>}{n.tail}</p>;
}

/** 一行一条操作：时刻、来源、动作、主体与小字、连带 N 项、◎ 定位、展开。 */
export function HistoryRow({ record, open, flash, onToggle, onLocate, onCopy }:
  { record: HistoryRecord; open: boolean; flash?: boolean; onToggle: () => void; onLocate?: () => void; onCopy?: (text: string) => void }) {
  const t = clockParts(record.at), fx = record.effects.length, target = locateLabel(locateOf(record)), sum = rowSummary(record);
  const onKey = (e: KeyboardEvent) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onToggle(); } };
  return <div className="oh-item" data-id={record.id}>
    <div className={`oh-row${flash ? ' flash' : ''}`} role="button" tabIndex={0} aria-expanded={open} onClick={onToggle} onKeyDown={onKey}>
      <span className="oh-t">{t.hm}<small>:{t.s}</small></span>
      <SourceFrom record={record} />
      <ActLabel record={record} />
      <span className="oh-sum"><b>{sum.text}</b><span>{sum.meta}</span></span>
      <span className="oh-fx">{fx ? `连带 ${fx} 项` : ''}</span>
      {onLocate ? <button type="button" className="oh-loc" title={`定位到 ${target}`} aria-label={`定位到 ${target}`}
        onClick={e => { e.stopPropagation(); onLocate(); }}><LocIcon /></button> : <span />}
      <span className="oh-chev"><ChevIcon /></span>
    </div>
    {open && <HistoryDetail record={record} onCopy={onCopy} />}
  </div>;
}

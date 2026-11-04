import type { HistoryRecord } from '../../shared/history';
import { Button } from '../../ui/controls/Button';
import { ActLabel, ChevIcon } from './HistoryRow';
import { agentClass, agentLabel, agentOf, rowSummary, SRC_LABEL, whenLabel } from './model';
import './history.css';

/**
 * 设置 09「最近调用」：最近几条改动了数据的自动化调用。点一条在「列表 → 操作历史」里展开它；
 * records 为 null 是还在读。
 */
export function RecentCalls({ records, today, onOpen, onAll, error }:
  { records: HistoryRecord[] | null; today: string; onOpen: (r: HistoryRecord) => void; onAll: () => void; error?: string | null }) {
  if (error) return <div className="oh-set-card"><p className="st-err">读取最近调用失败：{error}</p></div>;
  if (records === null) return <div className="oh-set-card"><p className="oh-set-stub">正在读取…</p></div>;
  if (!records.length) return <div className="oh-set-card"><div className="oh-empty-box"><b>还没有 AI 或脚本改动过数据</b>
    按下面「MCP 配置」或「CLI 命令」接入后，每次改动数据的调用都会出现在这里，也能在「列表 → 操作历史」里查看。</div></div>;
  return <div className="oh-set-card">
    <ul className="oh-recent">{records.map(r => {
      const w = whenLabel(r, today), agent = agentOf(r.source)!;
      return <li key={r.id}><button type="button" title="在操作历史里打开这一条" onClick={() => onOpen(r)}>
        <span className="when"><small>{w.prefix}</small>{w.time}</span>
        <span className="oh-src auto">{SRC_LABEL[r.source.kind]}</span>
        <span className={`oh-via oh-agent ${agentClass(agent)}`.trim()}>{agentLabel(agent)}</span>
        <ActLabel record={r} />
        <span className="oh-sum"><b>{rowSummary(r).text}</b></span>
        <span className="go"><ChevIcon /></span>
      </button></li>;
    })}</ul>
    <div className="oh-recent-foot">
      <p>只列改动了数据的调用；查询和失败的调用不记。调用方是对方自己报的名字：MCP 取客户端握手信息，CLI 认常见 agent 的环境变量；脚本可以加 <code>--agent 名字</code> 或设 <code>MONORAIL_AGENT</code> 指定。</p>
      <Button tone="ink" onClick={onAll}>查看全部操作历史 →</Button>
    </div>
  </div>;
}

import { useEffect, useRef, useState } from 'react';
import { formatReadout } from '../../shared/duration';
import { ActionButton } from '../../ui/controls/Button';
import { InlineInput } from '../../ui/controls/InlineInput';
import { ProjectPicker } from '../../ui/controls/ProjectPicker';
import type { ProjectOption } from '../../ui/controls/ProjectPicker';
import { TagPicker } from '../../ui/controls/TagPicker';
import { Topo } from '../../ui/effects/Topo';
import { MarkedText } from '../../ui/marks/MarkedText';
import type { CardLook } from './CardFrame';
import { HitNote, TimeField } from './TimeField';
import type { ReadoutNote } from './TimeField';
import type { TimerActions, TimerEntry } from './TimerBar';
import { hm } from './useEntry';

/**
 * 首页右上角临时活动下拉抽屉（ADR 0006，对应 HTML 原型 v4 stage.js 的 AwayDrawer）：
 * 插入快捷活动或临时活动（kind === '插入'）时，从 .home-stage 右上角垂下，
 * 采用与首页大卡同源的三段式浅色简约布局，底层首页卡片内容保持原状不变。
 */
export function AwayDrawer({ away, now, look, projects, knownTags, actions }:
  { away: TimerEntry; now: number; look: CardLook; projects: ProjectOption[]; knownTags: string[]; actions: TimerActions }) {
  const [draft, setDraft] = useState<string | null>(null);
  const [note, setNote] = useState<ReadoutNote | null>(null);
  const editing = useRef<{ id: string; description: string } | null>(null);

  useEffect(() => { setNote(null); setDraft(null); editing.current = null; }, [away.id]);

  const awayElapsed = Math.max(0, now - Date.parse(away.startedAt));
  const beginEdit = () => {
    editing.current = { id: away.id, description: away.description };
    setDraft(away.description);
  };
  const finishEdit = (keep: boolean) => {
    if (!editing.current) return;
    const text = draft?.trim(), { id, description } = editing.current;
    if (keep && text && text !== description) actions.editOpen(id, { description: text });
    editing.current = null;
    setDraft(null);
  };

  return <aside className="away-wrap" role="region" aria-label="临时活动">
    <div className="away-drawer">
      <div className="away-bg" aria-hidden="true">
        <Topo mode={look.topoMode} depth={look.topoDepth} cell={10} alpha={0.55} running />
      </div>
      <div className="away-in">
        <div className="away-head">
          <i className="away-dot" aria-hidden="true" />
          <b>临时活动</b>
          <span className="c-meta c-picks away-picks">
            记到
            <ProjectPicker flat id="away-project" value={away.project} options={projects}
              onChange={project => actions.editOpen(away.id, { project })} onCreate={actions.createProject} />
            <TagPicker flat id="away-tags" value={away.tags} options={knownTags}
              onChange={tags => actions.editOpen(away.id, { tags })} onCreate={actions.createTag} />
          </span>
          <span className="away-time-note">开始于 <b>{hm(away.startedAt)}</b></span>
        </div>
        <div className="away-hero">
          {draft !== null
            ? <InlineInput id="away-edit" className="away-edit" aria-label="临时活动名称" value={draft}
                onChange={setDraft} onDone={finishEdit} />
            : <h2 className="away-title" title="点一下或双击修改临时活动名称" onClick={beginEdit} onDoubleClick={beginEdit}>
                <MarkedText content={away.description} />
              </h2>}
        </div>
        <div className="away-foot">
          <ActionButton primary compact data-entry-keep="" className="away-back" cn="回来" en="BACK" icon="back"
            title={`回来 · ${away.description}`} aria-label={`回来 · ${away.description}`} onClick={actions.resume} />
          <div className="away-read">
            <span className="k">ELAPSED<em>临时计时</em></span>
            <span className="away-digits" role="timer">
              <TimeField id="away-elapsed" kind="mmss" shown={awayElapsed}
                target={() => ({ mode: 'entry', id: away.id })} submit={actions.readout} onNote={setNote}>
                {formatReadout(awayElapsed, 'mmss')}
              </TimeField>
            </span>
          </div>
        </div>
      </div>
    </div>
    {note && <div className="away-hit"><HitNote note={note} /></div>}
  </aside>;
}

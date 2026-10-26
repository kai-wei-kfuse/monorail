import type { ReactNode } from 'react';
import type { IconName } from '../../ui/icons/Icon';
import { ActionButton } from '../../ui/controls/Button';
import type { CardLook } from './CardFrame';
import { CardFrame } from './CardFrame';

/** 空状态的引导卡：样式和普通卡一样，只有一个主按钮；不计时，计时保持在待机。 */
export const GUIDES = {
  firstProject: { en: 'FIRST PROJECT', title: '建第一个项目', desc: '背包是空的。先放一个正在推进的大方向，比如「找工作」。', cn: '新建项目', btnEn: 'NEW', icon: 'plus' },
  setMain: { en: 'SET MAINLINE', title: '设定主线', desc: '还没有主线。选一个项目作为这一期的押注，选错的代价远小于一直没有主线。', cn: '设定主线', btnEn: 'SET', icon: 'check' },
  splitMain: { en: 'SPLIT A CARD', title: '给主线拆一张卡', desc: '主线下面还没有卡。拆一件能明确判断完成的事，或者一段计满的时间。', cn: '拆一张卡', btnEn: 'SPLIT', icon: 'plus' },
  allDone: { en: 'ALL CLEAR', title: '今天的卡都做完了', desc: '卡池里已经没有待做的卡。想到什么就写一行。', cn: '写一行', btnEn: 'WRITE', icon: 'plus' },
} satisfies Record<string, { en: string; title: string; desc: string; cn: string; btnEn: string; icon: IconName }>;

export type GuideKind = keyof typeof GUIDES;

export function GuideCard({ kind, look, onAction, extra }: { kind: GuideKind; look: CardLook; onAction: () => void; extra?: ReactNode }) {
  const g = GUIDES[kind];
  return <CardFrame look={look} slotNo="00" slotLabel="GUIDE">
    <div />
    <div className="alt-hero" data-fx="title">
      <span className="k" data-fx="decode">{g.en}</span>
      <h1>{g.title}</h1>
      <p>{g.desc}</p>
    </div>
    <div />
    <div className="foot"><div className="actions" data-fx="actions">
      <ActionButton primary cn={g.cn} en={g.btnEn} icon={g.icon} onClick={onAction} />{extra}
    </div></div>
  </CardFrame>;
}

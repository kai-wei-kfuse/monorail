import type { ReactNode } from 'react';
import './layout.css';

/** 分组：6px 黑方块 + 中文 + 英文小字 + 一条细线，下面放若干 Row。right 是细线右端的一句小字（比如「1 / 2 个」）。 */
export function Group({ cn, en, right, children }: { cn: string; en: string; right?: ReactNode; children: ReactNode }) {
  return <section className="s-group"><h3><b>{cn}</b><span>{en}</span>{right !== undefined && <em className="g-right">{right}</em>}</h3>{children}</section>;
}

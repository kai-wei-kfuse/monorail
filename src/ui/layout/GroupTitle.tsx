import type { ReactNode } from 'react';
import './layout.css';

/** 分组：6px 黑方块 + 中文 + 英文小字 + 一条细线，下面放若干 Row。 */
export function Group({ cn, en, children }: { cn: string; en: string; children: ReactNode }) {
  return <section className="s-group"><h3><b>{cn}</b><span>{en}</span></h3>{children}</section>;
}

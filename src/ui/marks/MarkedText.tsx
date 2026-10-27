// 卡片内容里用 [词] 标重点词：首页标题、小窗、队列里高亮成强调色底块，其他地方去掉方括号。纯显示约定。

export interface MarkPart { text: string; mark: boolean }

/** 把「沿 [Python] 往下学」拆成普通段和重点词段。没配对的方括号按原文保留。 */
export function parseMarks(content: string): MarkPart[] {
  const parts: MarkPart[] = [];
  const re = /\[([^\]\n]+)\]/g;
  let last = 0;
  for (let m = re.exec(content); m; m = re.exec(content)) {
    if (m.index > last) parts.push({ text: content.slice(last, m.index), mark: false });
    parts.push({ text: m[1], mark: true });
    last = m.index + m[0].length;
  }
  if (last < content.length) parts.push({ text: content.slice(last), mark: false });
  return parts;
}

/** 去掉方括号的纯文字。 */
export const plainText = (content: string) => parseMarks(content).map(p => p.text).join('');

/** 渲染成文字 + 强调色底块。 */
export function MarkedText({ content }: { content: string }) {
  return <>{parseMarks(content).map((p, i) => p.mark ? <span key={i} className="hl">{p.text}</span> : p.text)}</>;
}

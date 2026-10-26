import './shell.css';

/** 底栏的底线标记「主线 ✓ / 支线 ·」：只显示，不提醒。没有主线时主线底线不适用，显示「—」。 */
export function BaselineMarks({ main, side }: { main: boolean | null; side: boolean }) {
  const mark = (done: boolean | null) => (done === null ? '—' : done ? '✓' : '·');
  return <span className="baseline" title="每日底线：至少完成 1 张主线卡和 1 张支线卡">
    <span className={main ? 'done' : undefined}>主线<i>{mark(main)}</i></span>
    <span className={side ? 'done' : undefined}>支线<i>{mark(side)}</i></span>
  </span>;
}

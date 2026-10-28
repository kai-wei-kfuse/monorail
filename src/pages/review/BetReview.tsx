import { Button } from '../../ui/controls/Button';
import './review.css';

const day = (iso: string) => { const d = new Date(iso); return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日`; };

/**
 * 主线复盘：到了主线押注期，决定继续还是换。主线是押注，不是真相；选错的代价远小于一直没有主线。
 * 继续：押注期往后延一期。换：由回顾页打开「设定主线」对话框，完成后这一步算做完。
 */
export function BetReview({ task, betEndsAt, betWeeks, onContinue, onSwitch }:
  { task: string; betEndsAt: string; betWeeks: number; onContinue: (at: string) => void; onSwitch?: () => void }) {
  return <div className="rv-bet">
    <span className="k">MAINLINE BET</span>
    <h4>「{task}」的押注到期了</h4>
    <p>押注到 {day(betEndsAt)}。它还是对当前目标最有用的方向吗？选「继续」会再押 {betWeeks} 周。</p>
    <div className="rv-foot">
      <Button disabled={!onSwitch} title={onSwitch ? undefined : '背包里找不到这条主线，请重新进入回顾'} onClick={onSwitch}>换一条主线</Button>
      <Button tone="ink" onClick={() => onContinue(new Date().toISOString())}>继续押注</Button>
    </div>
  </div>;
}

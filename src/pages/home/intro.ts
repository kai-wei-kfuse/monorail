// 首页开场编排（UI风格规范 §8.2）：冷启动播完整版，约 1.2 秒；从托盘唤回控制在 400ms 以内。
// 动画期间按钮就能点：所有动画都是 fill: backwards，不挡交互。元素靠 data-fx 找。
import { fadeIn, motionLevel, play } from '../../ui/effects/animate';
import { decode } from '../../ui/effects/decode';
import { popBars, revealLines, scrambleDigits } from '../../ui/effects/reveal';

const $ = (root: ParentNode, fx: string) => root.querySelector(`[data-fx="${fx}"]`);
const $$ = (root: ParentNode, fx: string) => [...root.querySelectorAll(`[data-fx="${fx}"]`)];
const bars = (root: ParentNode) => $(root, 'bars')?.children ?? [];

/** 冷启动：标题栏依次落下 → 扫描线划过、等高线铺开、标签条伸出 → 竖条一道波 → 标题升起 → 角标飞入 → 按钮上浮 → 数字乱跳归位。 */
export function playColdIntro(app: ParentNode, card: ParentNode, digits: HTMLElement | null) {
  const level = motionLevel();
  if (level === 'off') return;
  if (level === 'reduced') { fadeIn($(card, 'card')); return; }
  $$(app, 'in').forEach((el, i) => play(el, [{ opacity: 0, transform: 'translateY(-8px)' }, { opacity: 1, transform: 'none' }], { duration: 420, delay: i * 60 }));
  play($(card, 'card'), [{ opacity: 0, transform: 'scale(.992)' }, { opacity: 1, transform: 'none' }], { duration: 380 });
  play($(card, 'topo'), [{ clipPath: 'inset(0 0 100% 0)' }, { clipPath: 'inset(0 0 0 0)' }], { duration: 560, delay: 80, ease: 'snap' });
  play($(card, 'vtab'), [{ transform: 'scaleY(0)' }, { transform: 'none' }], { duration: 440, delay: 140, ease: 'snap' });
  play($(card, 'head'), [{ opacity: 0, transform: 'translateX(-14px)' }, { opacity: 1, transform: 'none' }], { duration: 480, delay: 220 });
  popBars(bars(card), 300);
  revealLines($$(card, 'title'), 380);
  play($(card, 'corner-tl'), [{ opacity: 0, transform: 'translate(-16px, -16px)' }, { opacity: 1, transform: 'none' }], { duration: 480, delay: 660 });
  play($(card, 'corner-bk'), [{ opacity: 0, transform: 'translate(16px, 16px)' }, { opacity: 1, transform: 'none' }], { duration: 480, delay: 700 });
  [...($(card, 'actions')?.children ?? [])].forEach((b, i) => play(b, [{ opacity: 0, transform: 'translateY(12px)' }, { opacity: 1, transform: 'none' }], { duration: 480, delay: 640 + i * 70 }));
  const cancelDigits = scrambleDigits(digits, 420, 520);
  $$(card, 'decode').forEach(el => decode(el, 520));
  return cancelDigits;
}

/** 从托盘唤回：只做 320ms 内的轻量入场。 */
export function playResumeIntro(card: ParentNode) {
  if (motionLevel() === 'off') return;
  fadeIn($(card, 'card'), 220);
  revealLines($$(card, 'title').map(el => el), 0).forEach(a => a && (a.effect as KeyframeEffect).updateTiming({ duration: 320 }));
}

/** 再抽一张的擦除退场时：新标题重新升起，竖条再弹一次（§8.3 第 5 条）。 */
export function playAfterWipe(card: ParentNode) {
  revealLines($$(card, 'title'), 0);
  popBars(bars(card), 0);
}

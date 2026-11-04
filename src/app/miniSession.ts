/**
 * 小窗里的会话世代守卫（0.3.0-beta.3 D4，执行方案 E5 第 5 条）。
 * 异步回调（命令回复、读数确认、onNote）发起时记下当时的世代，回来时世代变了就丢弃，
 * 防止旧会话的错误、确认按钮或提示晚到后写进新会话的界面。
 */
export function epochGuard(current: () => number) {
  return {
    /** 包一个回调：只有在 started 仍是当前世代时才执行。 */
    bind<A extends unknown[]>(started: number, fn: (...args: A) => void): (...args: A) => void {
      return (...args: A) => { if (current() === started) fn(...args); };
    },
    isCurrent: (started: number) => current() === started,
  };
}

/** 新会话的快照到了：小窗要清掉的东西。纯函数，方便测试。 */
export function isNewSession(previous: number | null, next: number): boolean {
  return previous !== null && next > previous;
}

export const RELOADED_MESSAGE = '主窗口已重新载入';

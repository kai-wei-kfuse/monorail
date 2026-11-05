import { startSystemInTx, openInTx } from './tracking/api';
import type { Transaction } from './commit';

/**
 * 0.3.1（已定 48、55，ADR 0021 第 7 条）：不再按拒绝次数自动进入降级休息；主动休息是首页〔休息一下〕（homeService.restInTx，一条插入）。
 * 这里只剩一件事：0.3.0 遗留的降级休息（用户在 0.3.0 降级休息中升级，state.rest 不为空），
 * 在启动后的第一个事务（dayChange）里按 0.3.0 的〔回来〕处理一次：那段休息照常留着，转成待机，不问回答、不计数，然后清空。
 * refusals / last_rest_ended_at / rest_answers 不再写新值（state.yaml 照写原值，0.3.0 要求有这些字段）。
 */
export function settleLegacyRestInTx(tx: Transaction): boolean {
  if (!tx.state.rest) return false;
  const open = openInTx(tx);
  if (open?.project === '休息') startSystemInTx(tx, '待机');
  tx.state.rest = null;
  tx.state.home_mode = tx.state.current_card ? 'task' : 'blank';
  return true;
}


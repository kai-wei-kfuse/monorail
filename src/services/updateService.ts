import type { UpdatesPort } from '../platform/updater';
import type { Ctx } from './commit';
import { pauseCommits } from './commit';

/** Successful Windows installation exits the process; any rejected install restores admission. */
export async function installUpdate(
  ctx: Ctx,
  updater: Pick<UpdatesPort, 'prepareInstall' | 'install' | 'cancelInstall' | 'focusDirtyWindow'>,
): Promise<void> {
  const barrier = pauseCommits(ctx);
  let prepared = false;
  try {
    const preparing = await updater.prepareInstall();
    if (preparing.error) throw new Error(preparing.error.message);
    prepared = true;
    await barrier.ready;
    const result = await updater.install();
    if (result.error) throw new Error(result.error.message);
  } catch (error) {
    if (prepared) {
      // Do not admit writes if an IPC failure leaves the native installer state unknown.
      await updater.cancelInstall(error instanceof Error ? error.message : String(error));
    }
    barrier.resume();
    await updater.focusDirtyWindow?.().catch(() => null);
    throw error;
  }
}

import type { Ctx } from '../services/commit';
import { run } from '../services/commit';
import type { FileSystem } from '../data/fs';
import { createWrite } from '../data/journal';

export async function prepareInterruptedJournal(ctx: Ctx, fs: FileSystem) {
  const original = fs.atomicWrite;
  const token = crypto.randomUUID();
  fs.atomicWrite = async (path, text) => {
    if (path === 'verification-second.txt') throw new Error('EXPECTED_NATIVE_JOURNAL_WRITE_FAILURE');
    await original(path, text);
  };
  try {
    await run(ctx, async tx => {
      for (const path of ['verification-first.txt', 'verification-second.txt']) {
        tx.writes.push(createWrite(path, token, (await fs.read(path))?.text ?? null));
      }
    });
    throw new Error('Fault injection did not execute');
  } catch (error) {
    if (!(error instanceof Error) || error.message !== 'EXPECTED_NATIVE_JOURNAL_WRITE_FAILURE') throw error;
    await ctx.log(`verification-journal-pending:${JSON.stringify({ token, journals: await fs.list('.journal'), first: await fs.read('verification-first.txt'), second: await fs.read('verification-second.txt') })}`);
  } finally { fs.atomicWrite = original; }
}

import type { Ctx } from '../services/commit';

export async function prepareInterruptedJournal(ctx: Ctx) {
  const original = ctx.fs.atomicWrite;
  const token = crypto.randomUUID();
  ctx.fs.atomicWrite = async (path, text) => {
    if (path === 'verification-second.txt') throw new Error('EXPECTED_NATIVE_JOURNAL_WRITE_FAILURE');
    await original(path, text);
  };
  try {
    await ctx.commit(async tx => {
      for (const path of ['verification-first.txt', 'verification-second.txt']) {
        tx.writes.push({ path, text: token, before: (await ctx.fs.read(path))?.text ?? null });
      }
    });
    throw new Error('Fault injection did not execute');
  } catch (error) {
    if (!(error instanceof Error) || error.message !== 'EXPECTED_NATIVE_JOURNAL_WRITE_FAILURE') throw error;
    await ctx.log(`verification-journal-pending:${JSON.stringify({ token, journals: await ctx.fs.list('.journal'), first: await ctx.fs.read('verification-first.txt'), second: await ctx.fs.read('verification-second.txt') })}`);
  } finally { ctx.fs.atomicWrite = original; }
}

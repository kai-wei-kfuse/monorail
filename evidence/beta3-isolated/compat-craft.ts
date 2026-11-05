// v0.2.5 兼容矩阵的数据构造（ADR 0019「兼容与恢复」1–5）：用 beta.3 的真代码在一份数据副本上制造各种未完成 journal。
// 由 compat.mjs 用 esbuild 打包后运行：node compat-craft.mjs <scenario> <dataDir>
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createRepos } from '../../src/data/repos';
import type { FileSystem } from '../../src/data/fs';
import { createContext } from '../../src/services/commit';
import { change } from '../../src/services/settingsService';
import { runTx } from './compat-run';
import { createRecord } from '../../src/domain/record/record';
import { settings as readSettings } from './compat-run';

/** 与 tauriFs 同样的语义（临时文件 + rename），可以在指定路径上注入失败模拟断电。 */
function nodeFs(root: string, failOn?: (path: string, n: number) => boolean): FileSystem {
  let n = 0;
  const full = (p: string) => join(root, ...p.split('/'));
  return {
    async read(p) { try { const f = full(p), [s, t] = await Promise.all([stat(f), readFile(f, 'utf8')]); return { text: t, version: `${s.mtimeMs}:${s.size}` }; } catch { return null; } },
    async list(dir, recursive = false) {
      const walk = async (rel: string): Promise<string[]> => {
        let entries; try { entries = await readdir(full(rel || '.'), { withFileTypes: true }); } catch { return []; }
        const out: string[] = [];
        for (const e of entries) { const name = rel ? `${rel}/${e.name}` : e.name; if (e.isFile()) out.push(name); else if (recursive && e.isDirectory()) out.push(...await walk(name)); }
        return out;
      };
      return (await walk(dir)).sort();
    },
    async atomicWrite(p, text) {
      if (failOn?.(p, n++)) throw new Error(`INJECTED_POWER_LOSS at ${p}`);
      const f = full(p); await mkdir(dirname(f), { recursive: true });
      const tmp = `${f}.tmp-${crypto.randomUUID()}`; await writeFile(tmp, text); await rename(tmp, f);
    },
    async remove(p) { await rm(full(p), { force: true }); },
  };
}

const [scenario, data] = process.argv.slice(2);
const out: Record<string, unknown> = { scenario, data };
const ctxOf = async (fs: FileSystem) => {
  const repos = createRepos(fs); await repos.recover();
  const s = await repos.settings.read(); await repos.times.scan(new Date().toISOString(), s.dayBoundaryHour);
  return createContext({ repos, settings: s, id: () => crypto.randomUUID(), now: () => new Date().toISOString(), publish: () => {}, log: async () => {}, reminders: { update: async () => {} } });
};
void readSettings;

if (scenario === 'm3') {
  // 设置历史改写（before 非空）且业务文件已部分写入：60 秒内连改两次标题字号，第二次提交时在写历史文件之前断电
  // （journal 计划里先写 settings.yaml、state.yaml，最后写 history/…；在 history 路径上注入失败 = 业务已写、历史改写未写）
  const fs = nodeFs(data, p => p.startsWith('history/') && armed);
  let armed = false;
  const ctx = await ctxOf(fs);
  await change(ctx, 'titleScale', 70, new Date().toISOString());
  armed = true;
  try { await change(ctx, 'titleScale', 80, new Date().toISOString()); out.secondCommit = 'unexpectedly succeeded'; }
  catch (e) { out.secondCommit = String(e); }
  out.journals = await fs.list('.journal');
  const plan = JSON.parse((await fs.read((out.journals as string[])[0]))!.text);
  out.plan = plan.writes.map((w: { path: string; before: string | null; text: string | null }) => ({ path: w.path, beforeNull: w.before === null, textNull: w.text === null }));
  out.settingsOnDisk = /titleScale: (\d+)/.exec((await fs.read('settings.yaml'))!.text)?.[1];
}
if (scenario === 'm2') {
  // 历史新建文件的未完成 journal：一次普通提交，journal 已落盘、写到第一个 history/ 文件时断电
  const fs = nodeFs(data, p => p.startsWith('history/') && armed);
  let armed = false;
  const ctx = await ctxOf(fs);
  armed = true;
  try { await runTx(ctx, async tx => { tx.state.home_mode = tx.state.home_mode === 'guide' ? 'blank' : 'guide'; }); } catch (e) { out.commit = String(e); }
  out.journals = await fs.list('.journal');
  const plan = JSON.parse((await fs.read((out.journals as string[])[0]))!.text);
  out.plan = plan.writes.map((w: { path: string; before: string | null }) => ({ path: w.path, beforeNull: w.before === null }));
}
if (scenario.startsWith('m5')) {
  // 快速记录吸收在不同中断点：先像快速记录条那样直接写一条带 created_via 的待办，再提交一次，在指定路径上断电
  //   m5-card：写到卡片文件时断电（卡片、标记、历史都没写）
  //   m5-record：卡片已写、写记录标记时断电
  //   m5-history：卡片、标记已写、写历史时断电
  const fs = nodeFs(data, p => armed && (scenario === 'm5-card' ? p.startsWith('cards/') : scenario === 'm5-record' ? p.startsWith('records/') : p.startsWith('history/')));
  let armed = false;
  const repos = createRepos(fs);
  const id = crypto.randomUUID(), rec = createRecord({ id, text: `兼容矩阵 5：${scenario}`, kind: '待办', created_at: new Date().toISOString(), due_at: null,
    blocking: false, task_id: null, card_id: null, tags: [], attachments: [], created_via: 'quickbar' });
  await repos.transact(crypto.randomUUID(), [await repos.records.write(rec, null)]);
  const ctx = await ctxOf(fs);
  armed = true;
  try { await runTx(ctx, async () => {}); out.commit = 'unexpectedly succeeded'; } catch (e) { out.commit = String(e); }
  out.recordId = id;
  out.journals = await fs.list('.journal');
  const j = (out.journals as string[])[0];
  if (j) out.plan = JSON.parse((await fs.read(j))!.text).writes.map((w: { path: string }) => w.path);
}
if (scenario === 'm4') {
  // 带 created_via、没有 history_logged_at 的快速记录条待办（还没被主窗口吸收），交给 v0.2.5 的 reconcile 去生成卡片、改写记录
  const fs = nodeFs(data), repos = createRepos(fs);
  const id = crypto.randomUUID(), rec = createRecord({ id, text: '兼容矩阵 4：旧版改写带新字段的记录', kind: '待办', created_at: new Date().toISOString(), due_at: null,
    blocking: false, task_id: null, card_id: null, tags: [], attachments: [], created_via: 'quickbar' });
  await repos.transact(crypto.randomUUID(), [await repos.records.write(rec, null)]);
  out.recordId = id;
  // 另找一条已经带 history_logged_at 的快速记录（beta.3 实测时存的），看旧版会不会动它
  for (const p of await fs.list('records')) { const t = (await fs.read(p))!.text; if (t.includes('history_logged_at')) { out.loggedRecord = p; break; } }
}
console.log(JSON.stringify(out));

// 只读：把 v1 备份拷进内存，用当前代码迁移，再和真实目录里已经迁好的 v2 对比。用法（在 app/ 下）：node rehearse.cjs <v1备份> <真实目录> <迁移时刻ISO>
const fs = require('fs'), path = require('path'), vm = require('vm');
const ts = require(path.resolve('node_modules/typescript'));
const cache = new Map();
function load(file) {
  file = path.resolve(file);
  if (cache.has(file)) return cache.get(file).exports;
  const module = { exports: {} }; cache.set(file, module);
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const req = name => name.startsWith('.') ? load(path.resolve(path.dirname(file), name) + '.ts') : require(require.resolve(name, { paths: [process.cwd()] }));
  vm.runInNewContext('(function(require,module,exports){' + code + '\n})', { crypto: global.crypto, structuredClone, console })(req, module, module.exports);
  return module.exports;
}
async function intoMemory(MemoryFs, root) {
  const memory = new MemoryFs(), list = [];
  (function walk(dir, rel) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!rel && ['attachments', 'backup', '.journal', '迁移记录.md'].includes(e.name)) continue;
      const name = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) walk(path.join(dir, e.name), name);
      else list.push([name, fs.readFileSync(path.join(dir, e.name), 'utf8')]);
    }
  })(root, '');
  for (const [name, text] of list) await memory.atomicWrite(name, text);
  return { memory, files: list.length };
}
async function main() {
  const [v1, real, cut] = process.argv.slice(2);
  const { MemoryFs } = load('src/data/memoryFs.ts'), { migrateV2 } = load('src/data/migrations/v2.ts'), { createRepos } = load('src/data/repos.ts');
  const a = await intoMemory(MemoryFs, v1), b = await intoMemory(MemoryFs, real);
  const result = await migrateV2(a.memory, { now: cut, id: () => crypto.randomUUID() });
  const ra = createRepos(a.memory), rb = createRepos(b.memory);
  const sa = await ra.settings.read(), sb = await rb.settings.read();
  await ra.times.scan(cut, sa.dayBoundaryHour); await rb.times.scan(new Date().toISOString(), sb.dayBoundaryHour);
  const tasks = async r => (await r.tasks.list()).map(t => `${t.value.name}|${t.value.slot}|${t.value.status}`).sort();
  const cards = async r => (await r.cards.list()).map(c => `${c.value.id}|${c.value.status}|${c.value.task_id ? 'task' : '-'}`).sort();
  // 迁移时刻以前开始的条目：开始、描述、项目、标签；正在计的那条结束时间可能已经被后来的使用改掉，只比开始
  const before = r => r.times.snapshot().filter(e => e.started_at < cut).map(e => `${e.started_at}|${e.description}|${e.project}|${e.tags.join(',')}`).sort();
  const diff = (x, y) => ({ onlyRehearsal: x.filter(i => !y.includes(i)), onlyReal: y.filter(i => !x.includes(i)) });
  const out = {
    v1Files: a.files, migrated: result.migrated, referenceChanges: result.changes.length,
    tasks: diff(await tasks(ra), await tasks(rb)), cards: diff(await cards(ra), await cards(rb)), entriesBeforeCut: diff(before(ra), before(rb)),
    counts: { tasks: (await tasks(ra)).length, cards: (await cards(ra)).length, entries: before(ra).length },
    presets: sa.lists.presets.length, projects: sa.lists.projects.map(p => p.name),
  };
  console.log(JSON.stringify(out, null, 2));
}
main().catch(e => { console.error(e); process.exitCode = 1; });

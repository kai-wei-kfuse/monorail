// Run from app/: node evidence/run-migration-copies.cjs. Source directories are read-only.
const fs = require('fs'), path = require('path'), vm = require('vm');
const ts = require('../node_modules/typescript');
const cache = new Map();
function load(file) {
  file = path.resolve(file);
  if (cache.has(file)) return cache.get(file).exports;
  const module = { exports: {} }; cache.set(file, module);
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const requireModule = name => name.startsWith('.') ? load(path.resolve(path.dirname(file), name) + '.ts') : require(name);
  vm.runInNewContext('(function(require,module,exports){' + code + '\n})', {
    crypto: global.crypto, structuredClone, console,
  })(requireModule, module, module.exports);
  return module.exports;
}
async function main() {
  const { MemoryFs } = load('src/data/memoryFs.ts'), { migrateV2 } = load('src/data/migrations/v2.ts');
  const { createRepos } = load('src/data/repos.ts'), { createContext } = load('src/services/commit.ts');
  const home = load('src/services/homeService.ts'), assert = require('assert/strict');
  const roots = ['.verification-data/desktop', '.verification-data/m1-smoke'];
  const config = path.join(process.env.APPDATA, 'local.pixelrecord.app', 'config.json');
  if (fs.existsSync(config)) {
    const root = JSON.parse(fs.readFileSync(config, 'utf8')).root;
    if (root && !roots.includes(root)) roots.push(root);
  }
  const results = [];
  for (const [index, root] of roots.entries()) {
    if (!fs.existsSync(path.join(root, 'state.yaml'))) continue;
    const memory = new MemoryFs(); let files = 0;
    async function copy(directory, relative = '') {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (!relative && ['attachments', 'backup'].includes(entry.name)) continue;
        const name = relative ? relative + '/' + entry.name : entry.name;
        if (entry.isDirectory()) await copy(path.join(directory, entry.name), name);
        else { await memory.atomicWrite(name, fs.readFileSync(path.join(directory, entry.name), 'utf8')); files++; }
      }
    }
    await copy(root);
    const start = Date.now();
    const result = await migrateV2(memory, { now: new Date().toISOString(), id: () => crypto.randomUUID() });
    const repos = createRepos(memory), settings = await repos.settings.read();
    let clock = Date.now();
    await repos.times.scan(new Date(clock).toISOString(), settings.dayBoundaryHour);
    assert.equal((await repos.state.read()).schemaVersion, 2);
    const ctx = createContext({ repos, settings, id: () => crypto.randomUUID(), now: () => new Date(clock).toISOString(),
      publish: () => {}, log: async () => {}, reminders: { update: async () => {} } });
    clock += 60000; await home.beginPending(ctx, ctx.now());
    clock += 60000; await home.startFree(ctx, { description: 'migration smoke', project: '未分类', tags: [], card_id: null }, ctx.now());
    clock += 60000; await home.pause(ctx, ctx.now());
    clock += 60000; await home.resume(ctx, ctx.now());
    assert.equal(repos.times.snapshot().filter(entry => entry.ended_at === null).length, 1);
    assert.equal(repos.times.snapshot().find(entry => entry.ended_at === null).description, 'migration smoke');
    assert.equal((await repos.cards.list()).filter(card => card.value.status === '进行中').length, 0);
    results.push({ source: index < 2 ? root : 'user-data-memory-copy', files, migrated: result.migrated,
      referenceChanges: result.changes.length, runtimeActions: 4, milliseconds: Date.now() - start });
  }
  fs.writeFileSync('evidence/n2-migration-copies.json', JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results));
}
main().catch(error => { console.error(error); process.exitCode = 1; });

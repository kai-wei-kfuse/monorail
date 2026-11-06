// Native EXE round trips. Only registered temporary identities are writable.
import assert from 'node:assert/strict';
import { cp, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { parse, stringify } from 'yaml';
import { baseline, connect, count, kill, launch, loadEnv, sleep } from '../0.3.1-isolated/lib.mjs';

const directory = resolve('evidence/release-0.3.1'), stamp = Date.now().toString();
const current = await loadEnv();
const source = join(tmpdir(), 'monorail-rt-data', 'a-031');
const produced = JSON.parse(await readFile('evidence/0.3.1-g9-roundtrip/results/1-produce031.json', 'utf8'));
const oldVersions = [
  { version: '0.3.0', data: join(tmpdir(), 'monorail-031-compat-native030', 'data'),
    exe: join(tmpdir(), 'monorail-031-compat-native030', 'Monorail-030.exe'),
    profile: join(process.env.APPDATA, 'local.pixelrecord.v031compat030') },
  { version: '0.2.5', data: join(tmpdir(), 'monorail-025-db06cfcd51d6', 'data'),
    exe: join(tmpdir(), 'monorail-025-db06cfcd51d6', 'Monorail-0.2.5-isolated.exe'),
    profile: join(process.env.APPDATA, 'local.pixelrecord.test025.tdb06cfcd51d6') },
];
const baselineInfo = b => ({ runHash: createHash('sha256').update(JSON.stringify(b.run)).digest('hex'), daily: b.daily });
const before = baselineInfo(baseline()), result = { before, versions: [] };
await mkdir(directory, { recursive: true });
const saved = [];
function temporary(path) {
  assert.ok(resolve(path).startsWith(resolve(tmpdir()) + '\\'), `not a temporary path: ${path}`);
}
async function reserve(target) {
  temporary(target.data); temporary(target.exe);
  assert.ok(existsSync(target.exe), target.exe);
  assert.equal(count(target.exe), 0, `process already running: ${target.exe}`);
  assert.equal(JSON.parse(await readFile(join(target.profile, 'config.json'), 'utf8')).root.toLowerCase(), target.data.toLowerCase());
  const backup = `${target.data}.before-native-${stamp}`;
  assert.ok(!existsSync(backup));
  await rename(target.data, backup);
  const lifecycle = join(target.profile, 'lifecycle.json');
  const savedLife = existsSync(lifecycle) ? `${lifecycle}.before-native-${stamp}` : null;
  if (savedLife) await rename(lifecycle, savedLife);
  saved.push({ ...target, backup, lifecycle, savedLife });
}
async function seed(target) {
  await cp(source, target.data, { recursive: true });
  const file = join(target.data, 'settings.yaml'), settings = parse(await readFile(file, 'utf8'));
  // The fixture defaults enable autostart and daily shortcuts; native tests must not register them.
  Object.assign(settings, { autostart: false, quickbarHotkey: 'Ctrl+Alt+Shift+F9', mainHotkey: 'Ctrl+Alt+Shift+F10' });
  await writeFile(file, stringify(settings));
}
async function fileState(target) {
  const settings = parse(await readFile(join(target.data, 'settings.yaml'), 'utf8'));
  const rest = await readFile(join(target.data, 'cards', `${produced.restId}.md`), 'utf8');
  const plans = {};
  for (const day of ['2026-11-06', '2026-11-07']) plans[day] = createHash('sha256').update(await readFile(join(target.data, 'plans', `${day}.yaml`))).digest('hex');
  return { plans, rest, titleScale: settings.titleScale, four: { taskMode: settings.taskMode, trackingMode: settings.trackingMode,
    insertBackPlace: settings.insertBackPlace, idleAskMinutes: settings.idleAskMinutes } };
}
async function open(target, port, label) {
  launch(target.exe, port);
  const page = await connect(port, 'main');
  await page.waitFor("document.body.innerText.includes('首页') && !document.body.innerText.includes('正在打开数据目录')", 30_000, `${label} ready`);
  assert.ok(!(await page.text()).includes('打不开数据目录'));
  await page.shot(join(directory, `native-${label}.png`));
  return page;
}
async function close(target, page) { page.close(); kill(target.exe); assert.equal(count(target.exe), 0); }

try {
  await reserve(current);
  for (const old of oldVersions) {
    await reserve(old); await seed(old);
    const initial = await fileState(old);
    const page = await open(old, 19410, `${old.version}-open`);
    await page.click('.tab-btn', '设置');
    await page.click('.s-item', '外观');
    await page.waitFor("!!document.querySelector('[role=slider][aria-label=\"首页标题字号\"]')");
    await page.eval("document.querySelector('[role=slider][aria-label=\"首页标题字号\"]').focus()");
    await page.key('ArrowRight');
    await page.waitFor("document.querySelector('[role=slider][aria-label=\"首页标题字号\"]').getAttribute('aria-valuenow')==='66'");
    // Wait for the real settings transaction rather than accepting a React-only update.
    while ((await fileState(old)).titleScale !== 66) await sleep(100);
    await page.shot(join(directory, `native-${old.version}-write.png`));
    await close(old, page);
    const written = await fileState(old);
    assert.deepEqual(written.plans, initial.plans);
    assert.equal(written.rest, initial.rest);
    assert.deepEqual(written.four, initial.four);
    // Preserve all native output; restore G9's original data after this script.
    if (existsSync(current.data)) await rename(current.data, `${current.data}.native-previous-${old.version}-${stamp}`);
    await cp(old.data, current.data, { recursive: true });
    const newPage = await open(current, 19411, `${old.version}-back031`);
    await newPage.click('.tab-btn', '设置'); await newPage.click('.s-item', '外观');
    await newPage.waitFor("document.querySelector('[role=slider][aria-label=\"首页标题字号\"]')?.getAttribute('aria-valuenow')==='66'");
    await newPage.eval("document.querySelector('[role=slider][aria-label=\"首页标题字号\"]').focus()");
    await newPage.key('ArrowRight');
    while ((await fileState(current)).titleScale !== 67) await sleep(100);
    await close(current, newPage);
    const returned = await fileState(current);
    assert.equal(returned.titleScale, 67);
    assert.deepEqual(returned.plans, initial.plans);
    assert.equal(returned.rest, initial.rest);
    assert.deepEqual(returned.four, initial.four);
    result.versions.push({ version: old.version, ok: true, initial, written, returned });
    console.log(`PASS native ${old.version} write -> 0.3.1 read/write`);
  }
} finally {
  for (const target of saved.reverse()) {
    kill(target.exe);
    if (existsSync(target.data)) await rename(target.data, `${target.data}.native-result-${stamp}`);
    await rename(target.backup, target.data);
    if (existsSync(target.lifecycle)) await rename(target.lifecycle, `${target.lifecycle}.native-result-${stamp}`);
    if (target.savedLife) await rename(target.savedLife, target.lifecycle);
  }
  result.after = baselineInfo(baseline());
  await writeFile(join(directory, 'native-roundtrip.json'), JSON.stringify(result, null, 2));
}
assert.deepEqual(result.after, before);
assert.equal(result.versions.length, 2);

// Native startup after an activity-day boundary, using yesterday's isolated fixture.
import assert from 'node:assert/strict';
import { cp, mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { parse, stringify } from 'yaml';
import { connect, count, kill, launch, loadEnv } from '../0.3.1-isolated/lib.mjs';

const env = await loadEnv(), stamp = Date.now(), backup = `${env.data}.before-rollover-${stamp}`;
const lifecycle = join(env.profile, 'lifecycle.json'), savedLife = existsSync(lifecycle) ? `${lifecycle}.before-rollover-${stamp}` : null;
assert.ok(resolve(env.data).startsWith(resolve(tmpdir()) + '\\')); assert.equal(count(env.exe), 0);
assert.equal(JSON.parse(await readFile(join(env.profile, 'config.json'), 'utf8')).root, env.data);
await rename(env.data, backup); if (savedLife) await rename(lifecycle, savedLife);
const result = {};
let page;
try {
  const source = join(tmpdir(), 'monorail-rt-data', 'a-031');
  await mkdir(env.data);
  const shift = s => s.replaceAll('2026-11-06', '2026-11-05').replaceAll('2026-11-07', '2026-11-06');
  for (const name of ['cards', 'tasks', 'records', 'history', 'reviews']) if (existsSync(join(source, name))) await cp(join(source, name), join(env.data, name), { recursive: true });
  for (const folder of ['plans', 'timelog']) {
    await mkdir(join(env.data, folder));
    for (const file of await readdir(join(source, folder))) await writeFile(join(env.data, folder, shift(file)), shift(await readFile(join(source, folder, file), 'utf8')));
  }
  // The original fixture already achieved its 30-minute goal (35 minutes spent), so it correctly would not carry.
  const previousPlanPath = join(env.data, 'plans', '2026-11-05.yaml');
  const previousPlan = parse(await readFile(previousPlanPath, 'utf8'));
  previousPlan.items.find(i => i.card_id === 'c-read').today_minutes = 45;
  await writeFile(previousPlanPath, stringify(previousPlan));
  await writeFile(join(env.data, 'state.yaml'), shift(await readFile(join(source, 'state.yaml'), 'utf8')));
  const settings = parse(await readFile(join(source, 'settings.yaml'), 'utf8'));
  Object.assign(settings, { autostart: false, quickbarHotkey: 'Ctrl+Alt+Shift+F9', mainHotkey: 'Ctrl+Alt+Shift+F10', taskMode: true });
  await writeFile(join(env.data, 'settings.yaml'), stringify(settings));
  launch(env.exe, 19413); page = await connect(19413, 'main');
  await page.waitFor("document.body.innerText.includes('首页') && !document.body.innerText.includes('正在打开数据目录')", 30_000);
  await page.click('.dock-toggle.bp-bag');
  await page.waitFor("!!document.querySelector('.bp-carry input')");
  const planFile = join(env.data, 'plans', '2026-11-06.yaml');
  const plan = parse(await readFile(planFile, 'utf8')), state = parse(await readFile(join(env.data, 'state.yaml'), 'utf8'));
  assert.equal(plan.rolled_over, true); assert.equal(plan.carried_from, '2026-11-05'); assert.equal(plan.carried_confirmed, false);
  assert.ok(plan.items.some(i => i.carried)); assert.equal(state.resume_entry_id, null); assert.equal(state.current_card, null);
  await page.shot('evidence/release-0.3.1/ui-rollover-carry.png');
  // Uncheck one carried item, then confirm: the actual carry service must remove it.
  const unchecked = await page.eval("(() => { const c=document.querySelector('.bp-carry input');const label=c.closest('label').innerText;c.click();return label; })()");
  await page.click('.bp-carry button', '确认');
  await page.waitFor("!document.querySelector('.bp-carry')");
  const confirmed = parse(await readFile(planFile, 'utf8'));
  assert.equal(confirmed.carried_confirmed, true); assert.equal(confirmed.items.length, plan.items.length - 1);
  page.close(); page = null; kill(env.exe);
  const stablePlan = await readFile(planFile, 'utf8');
  launch(env.exe, 19413); page = await connect(19413, 'main');
  await page.waitFor("document.body.innerText.includes('首页') && !document.body.innerText.includes('正在打开数据目录')", 30_000);
  assert.equal(await readFile(planFile, 'utf8'), stablePlan);
  Object.assign(result, { ok: true, sourceDay: plan.carried_from, initialItems: plan.items.length, confirmedItems: confirmed.items.length,
    unchecked, originalEnded: true, secondBootPlanUnchanged: true, method: 'yesterday fixture -> native startup; no system clock changes' });
  console.log('PASS native rollover, per-item carry confirmation, same-day restart idempotence');
} finally {
  page?.close(); kill(env.exe);
  if (existsSync(env.data)) await rename(env.data, `${env.data}.rollover-result-${stamp}`);
  await rename(backup, env.data);
  if (existsSync(lifecycle)) await rename(lifecycle, `${lifecycle}.rollover-result-${stamp}`);
  if (savedLife) await rename(savedLife, lifecycle);
  await writeFile('evidence/release-0.3.1/native-rollover.json', JSON.stringify(result, null, 2));
}

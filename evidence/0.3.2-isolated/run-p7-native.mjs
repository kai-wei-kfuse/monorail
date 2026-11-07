// 0.3.2 P7 隔离真窗口双窗矩阵实测：
// 覆盖：1) 底栏左侧 4 按钮 6px 紧凑间距；2) 任务详情单子项完成/取消完成与整张任务完成/重开；
// 3) 背包开始卡片 Wipe 一次性挂载（真实 WebView2）；4) 主窗自由计时显式〔＋ 插入事件〕；
// 5) 520×88 小窗与 320×46 超小窗 22×26px `+` 按钮、跨窗只读镜像、被动隐藏不撤草稿 vs 显式关窗撤回草稿、主窗隐藏后台提交、主窗重载重连 epoch 同步。
import assert from 'node:assert/strict';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { parse, stringify } from 'yaml';
import { defaults as v1Defaults } from '../../src/data/migrations/v1/settings.ts';
import { baseline, connect, count, here, kill, launch, loadEnv, sleep } from './lib.mjs';

const env = await loadEnv(), PORT = 19432, shots = join(here, 'shots');
await mkdir(shots, { recursive: true });
const resultsPath = join(here, 'results-p7.json');
const results = {};
const save = () => writeFile(resultsPath, JSON.stringify(results, null, 2));
const ctx = { main: null, mini: null };

async function main() {
  if (!ctx.main) ctx.main = await connect(PORT, 'main');
  return ctx.main;
}
async function mini() {
  if (!ctx.mini) ctx.mini = await connect(PORT, 'mini');
  return ctx.mini;
}

const homeReady = `document.body.innerText.includes('首页') && !document.body.innerText.includes('正在打开数据目录')`;
const settingsPath = () => join(env.data, 'settings.yaml');
const setSettings = async patch => {
  const s = parse(await readFile(settingsPath(), 'utf8'));
  await writeFile(settingsPath(), stringify(patch(s)));
};

async function timelogEntries() {
  const dir = join(env.data, 'timelog');
  if (!existsSync(dir)) return [];
  const files = (await readdir(dir)).filter(f => f.endsWith('.md')).sort();
  if (!files.length) return [];
  return parse(await readFile(join(dir, files.at(-1)), 'utf8')) ?? [];
}

async function restart() {
  ctx.mini?.close(); ctx.mini = null;
  ctx.main?.close(); ctx.main = null;
  kill(env.exe);
  await sleep(1200);
  launch(env.exe, PORT);
  const page = await main();
  await page.waitFor(homeReady, 30_000, 'home');
  await sleep(800);
  return page;
}

async function press(page, selector, text) {
  const r = await page.rect(selector, text);
  if (!r) throw new Error(`press: ${selector} ${text ?? ''}`);
  const x = r.x + r.w / 2, y = r.y + r.h / 2;
  await page.mouse('mouseMoved', x, y, 0);
  await page.mouse('mousePressed', x, y);
  await page.mouse('mouseReleased', x, y);
  await sleep(450);
}

const keepAlive = process.argv.includes('--keep-open');

const steps = {
  /** 1. 启动隔离实例 & 验证需求 #6（底栏左 4 按钮 .dock-actions gap: 6px） */
  async bootAndDockGap() {
    kill(env.exe);
    await sleep(600);
    await rm(env.data, { recursive: true, force: true });
    await mkdir(env.data, { recursive: true });
    await writeFile(join(env.data, 'settings.yaml'), stringify({
      ...v1Defaults,
      autostart: false,
      quickbarHotkey: 'Ctrl+Alt+Shift+F11',
      mainHotkey: 'Ctrl+Alt+Shift+F12',
    }));
    launch(env.exe, PORT);
    let page = await main();
    await page.waitFor(homeReady, 30_000, 'home');
    await setSettings(s => ({
      ...s,
      homeLayout: 'fused',
      lists: {
        ...s.lists,
        projects: [{ name: '学习', color: '#1aa3ff' }, { name: '工作', color: '#7c5cff' }],
        presets: [{ id: 'q-wc', name: '上厕所', project: '工作', tags: [], mode: '插入', place: '弹层' }],
      },
    }));
    page = await restart();
    const dockMetrics = await page.eval(`(() => {
      const wrap = document.querySelector('.dock-actions');
      if (!wrap) return null;
      const style = getComputedStyle(wrap);
      const btns = [...wrap.querySelectorAll('.dock-toggle')];
      const rects = btns.map(b => {
        const r = b.getBoundingClientRect();
        return { text: b.textContent.trim().replace(/\\s+/g, ' '), left: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width) };
      });
      const gaps = rects.slice(1).map((r, i) => r.left - rects[i].right);
      return { gapCss: style.gap, buttonCount: btns.length, rects, gaps };
    })()`);
    await page.shot(join(shots, '01-native-dock-gap-6px.png'));
    assert.ok(dockMetrics, 'dock-actions wrapper present');
    assert.equal(dockMetrics.gapCss, '6px');
    assert.equal(dockMetrics.buttonCount, 4);
    assert.ok(dockMetrics.gaps.every(g => Math.abs(g - 6) <= 1), `expected 6px gaps between 4 dock buttons, got ${JSON.stringify(dockMetrics.gaps)}`);
    return dockMetrics;
  },

  /** 2. 需求 #1（整张任务完成与重开）、需求 #7（任务详情单子项完成与取消完成）、需求 #5（背包开始卡片 Wipe 一次性生命周期） */
  async bagCompletionAndWipe() {
    const page = await main();
    await press(page, '.dock-toggle.bp-bag');
    await page.waitFor(`!!document.querySelector('.bp-drawer[data-open]')`, 5000, 'drawer open');
    await press(page, '.bq-new', '设定主线任务');
    await page.waitFor(`!!document.querySelector('#proj-name')`, 5000, 'task dialog');
    await page.eval(`document.querySelector('#proj-name').focus()`);
    await page.type('0.3.2 原生验收主线');
    await sleep(200);
    await page.eval(`document.querySelector('#task-items-0').focus()`);
    await page.type('子项 A：写接口');
    await sleep(200);
    await press(page, '.ie-foot .sbtn', '加一项');
    await page.eval(`document.querySelector('#task-items-1').focus()`);
    await page.type('子项 B：跑测试');
    await sleep(200);
    await press(page, '.dlg .sbtn.ink', '放入');
    await sleep(800);

    // 进入任务详情
    await press(page, '.bq .bp-more');
    await page.waitFor(`!!document.querySelector('.bp-detail')`, 5000, 'quest detail');
    await page.shot(join(shots, '02-native-quest-detail.png'));

    // 需求 #7：单子项完成 -> 取消完成
    await page.click('.bp-detail .bp-it .acts .bp-btn', '完成');
    await sleep(400);
    const afterSubtaskDone = await page.eval(`({
      doneCount: document.querySelectorAll('.bp-detail .bp-it.done').length,
      reopenText: document.querySelector('.bp-detail .bp-it.done .acts .bp-btn')?.textContent?.trim() ?? null,
    })`);
    await page.shot(join(shots, '03-native-subtask-done.png'));
    assert.equal(afterSubtaskDone.doneCount, 1);
    assert.equal(afterSubtaskDone.reopenText, '取消完成');

    await page.click('.bp-detail .bp-it.done .acts .bp-btn', '取消完成');
    await sleep(400);
    const afterSubtaskReopen = await page.eval(`document.querySelectorAll('.bp-detail .bp-it.done').length`);
    assert.equal(afterSubtaskReopen, 0);

    // 需求 #1：完成整张任务 -> 已完成列表 -> 重新打开整张任务
    await page.click('.bp-detail .bp-dfoot .bp-btn.ok', '完成整张任务');
    await page.waitFor(`!!document.querySelector('.dlg')`, 5000, 'complete task dialog');
    await page.shot(join(shots, '04-native-complete-task-dialog.png'));
    await page.click('.dlg .sbtn.ink', '完成整张任务');
    await page.waitFor(`!!document.querySelector('.bp-done-list .bp-done-row')`, 5000, 'done tasks list');
    await page.shot(join(shots, '05-native-done-tasks-list.png'));
    const doneRowText = await page.eval(`document.querySelector('.bp-done-list .bp-done-row')?.innerText?.replace(/\\s+/g, ' ')`);

    await page.click('.bp-done-list .bp-done-row .bp-btn', '重新打开');
    await page.waitFor(`!!document.querySelector('.dlg')`, 5000, 'reopen task dialog');
    await page.click('.dlg .sbtn.ink', '重新打开');
    await page.waitFor(`!!document.querySelector('.bp-grid .bq')`, 5000, 'reopened quest card');

    // 需求 #5：在详情点〔开始〕，验证真实 WebView2 下 Wipe 一次性挂载（wipeMounts === 1）
    await press(page, '.bq .bp-more');
    await page.waitFor(`!!document.querySelector('.bp-detail')`, 5000, 'quest detail before start');
    await page.eval(`(() => {
      window.__nativeWipe = { wipeMounts: 0, frames: [] };
      const root = document.getElementById('root');
      new MutationObserver(records => {
        for (const rec of records) {
          for (const node of rec.addedNodes) {
            if (node instanceof HTMLElement && (node.classList.contains('wipe') || node.querySelector?.('.wipe'))) {
              window.__nativeWipe.wipeMounts++;
              window.__nativeWipe.frames.push({ at: Math.round(performance.now()), text: node.innerText?.trim()?.replace(/\\s+/g, ' ') ?? '' });
            }
          }
        }
      }).observe(root, { childList: true, subtree: true });
    })()`);

    await page.click('.bp-detail .bp-it .bp-go', '开始');
    await sleep(260);
    await page.shot(join(shots, '06-native-bag-start-wipe.png'));
    await sleep(1400);
    const wipeResult = await page.eval(`window.__nativeWipe`);
    assert.equal(wipeResult.wipeMounts, 1, 'Native WebView2 bag start must mount .wipe exactly once');
    return { afterSubtaskDone, afterSubtaskReopen, doneRowText, wipeResult };
  },

  /** 3. 需求 #4（主窗口自由计时显式〔＋ 插入事件〕） */
  async mainFreeTimerExplicitInsert() {
    const page = await main();
    // 结束当前任务回到自由计时，或开始一条自由计时
    // 先把正在跑的卡暂停或通过自由记录切换：在卡片运行中先切回自由计时（开始一条自由计时并结束原任务）
    await press(page, '.c-rest', '插入事件');
    await page.waitFor(`!!document.querySelector('#ins-what')`, 5000, 'insert draft on card');
    await sleep(300);
    await page.eval(`document.querySelector('#ins-what').focus()`);
    await page.type('整理桌面');
    await sleep(200);
    await page.key('Enter');
    await page.waitFor(`!!document.querySelector('.ins-up-end')`, 8000, 'insert draft committed on disk');
    // 点〔结束原任务〕把卡片放回背包，使「整理桌面」还原成普通自由计时卡！
    await page.click('.ins-up-end');
    await page.waitFor(`!!document.querySelector('.dlg')`, 5000, 'end original task dialog');
    await page.click('.dlg .sbtn.ink', '结束');
    await page.waitFor(`!document.querySelector('.ins-top')`, 5000, 'promoted to free timer');
    await sleep(400);

    // 现在主窗口处于普通自由计时（「整理桌面」），验证融合布局自由计时卡头有〔＋ 插入事件〕！
    const hasFreeInsertBtn = await page.eval(`[...document.querySelectorAll('.c-rest')].some(b => b.textContent.includes('插入事件'))`);
    await page.shot(join(shots, '07-native-free-timer-insert-btn.png'));
    assert.equal(hasFreeInsertBtn, true, 'Free timer card must expose explicit [＋ 插入事件] button');

    // 点自由计时上的〔＋ 插入事件〕-> 弹出草稿 -> Esc 撤回不落盘
    const beforeCount = (await timelogEntries()).length;
    await page.click('.c-rest', '插入事件');
    await page.waitFor(`!!document.querySelector('#ins-what')`, 5000, 'free timer insert draft');
    await page.key('Escape');
    await page.waitFor(`!document.querySelector('.ins-top')`, 5000, 'free timer insert draft canceled');
    const afterCancelCount = (await timelogEntries()).length;
    assert.equal(afterCancelCount, beforeCount, 'Canceling free timer insert draft must not write timelog entry');
    return { hasFreeInsertBtn, beforeCount, afterCancelCount };
  },

  /** 4. 需求 #3 & P7 原生双窗口矩阵（520×88 mini + 320×46 tiny + 跨窗镜像 + 被动隐藏 vs 显式关窗 + 主窗隐藏后台提交 + 重载重连） */
  async dualWindowMatrix() {
    const mPage = await main();
    // 打开 520×88 小窗口
    await mPage.click('.dock-toggle[title="开关小窗口（M）"]');
    const sPage = await mini();
    await sPage.waitFor(`!!document.querySelector('.mini-btn.ins')`, 8000, 'mini explicit insert button');
    await sleep(400);

    // 4a. 核对 520×88 小窗口尺寸与 `+` 按钮（22×26px）
    const miniMetrics = await sPage.eval(`(() => {
      const btn = document.querySelector('.mini-btn.ins');
      const r = btn?.getBoundingClientRect();
      return {
        winW: window.innerWidth,
        winH: window.innerHeight,
        btnW: r ? Math.round(r.width) : null,
        btnH: r ? Math.round(r.height) : null,
      };
    })()`);
    await sPage.shot(join(shots, '08-native-mini-520x88-plus.png'));
    assert.equal(miniMetrics.btnW, 22);
    assert.equal(miniMetrics.btnH, 26);

    // 4b. 在小窗点 `+` 开启插入草稿 -> 验证小窗进入输入框且主窗同步显示只读镜像
    const entriesBeforeMiniDraft = (await timelogEntries()).length;
    await sPage.click('.mini-btn.ins');
    await sPage.waitFor(`!!document.querySelector('#mini-insert-name')`, 5000, 'mini insert input');
    await mPage.waitFor(`!!document.querySelector('.ins-top')`, 5000, 'main mirror of mini draft');
    await sleep(300);
    const mirrorInfo = await mPage.eval(`({
      meta: document.querySelector('.ins-top .c-meta')?.textContent?.trim() ?? '',
      title: document.querySelector('.ins-top h1.title')?.textContent?.trim() ?? '',
      hasEndOriginalBtn: !!document.querySelector('.ins-top .ins-up-end'),
    })`);
    await sPage.shot(join(shots, '09-native-mini-insert-draft.png'));
    await mPage.shot(join(shots, '10-native-main-mirror-of-mini-draft.png'));
    assert.match(mirrorInfo.meta, /小窗正在输入/);
    assert.equal(mirrorInfo.hasEndOriginalBtn, false);
    assert.equal((await timelogEntries()).length, entriesBeforeMiniDraft, 'Uncommitted mini draft must not write to disk');

    // 4c. 被动隐藏 vs 显式关窗（R3 原生验证）：
    // 先模拟非显式被动隐藏（直接调 WebView2 window hide，不经过 toggle_mini / CloseRequested，只触发 mini-visibility visible=false）
    await sPage.eval(`window.__TAURI_INTERNALS__.invoke('plugin:window|hide', { label: 'mini' })`);
    await sleep(500);
    const draftStillAliveAfterPassiveHide = await mPage.eval(`!!document.querySelector('.ins-top')`);
    assert.equal(draftStillAliveAfterPassiveHide, true, 'Passive mini hide must NOT withdraw mini insert draft');

    // 重新显示小窗，然后通过主窗底栏显式点「开关小窗口（M）」关闭小窗（触发 toggle_mini -> mini-explicit-close）
    await mPage.click('.dock-toggle[title="开关小窗口（M）"]');
    await sleep(400);
    await mPage.click('.dock-toggle[title="开关小窗口（M）"]');
    await mPage.waitFor(`!document.querySelector('.ins-top')`, 5000, 'explicit close withdraws mini draft');
    const entriesAfterExplicitClose = (await timelogEntries()).length;
    assert.equal(entriesAfterExplicitClose, entriesBeforeMiniDraft, 'Explicit close withdrawal must not write to disk');

    // 4d. 主窗口隐藏到后台时，小窗口发起插入草稿并回车提交落盘
    await mPage.click('.dock-toggle[title="开关小窗口（M）"]');
    await sPage.waitFor(`!!document.querySelector('.mini-btn.ins')`, 5000, 'mini re-opened');
    await mPage.eval(`window.__TAURI_INTERNALS__.invoke('plugin:window|hide', { label: 'main' })`);
    await sleep(400);
    await sPage.click('.mini-btn.ins');
    await sPage.waitFor(`!!document.querySelector('#mini-insert-name')`, 5000, 'mini insert input while main hidden');
    await sPage.eval(`document.querySelector('#mini-insert-name').focus()`);
    await sPage.type('小窗后台提交插入');
    await sleep(200);
    await sPage.key('Enter');
    await sPage.waitFor(`!document.querySelector('#mini-insert-name') && document.querySelector('.mini-title')?.textContent?.includes('小窗后台提交插入')`, 8000, 'mini committed while main hidden');
    await sleep(400);
    await sPage.shot(join(shots, '11-native-mini-committed-while-main-hidden.png'));
    const entriesAfterBgCommit = await timelogEntries();
    assert.equal(entriesAfterBgCommit.length, entriesBeforeMiniDraft + 1);
    assert.equal(entriesAfterBgCommit.at(-1).description, '小窗后台提交插入');
    assert.equal(entriesAfterBgCommit.at(-1).kind, '插入');

    // 恢复显示主窗口并从小窗回到原来的事
    await mPage.invoke('show_main');
    await sleep(400);
    await sPage.click('.mini-btn.back[aria-label="回到任务"]');
    await mPage.waitFor(`!document.querySelector('.ins-top')`, 5000, 'returned from insert to free timer');

    // 4e. 切换到 320×46 超小窗（miniMode = 'tiny'），验证超小窗 `+` 按钮、草稿输入与撤回
    await mPage.click('.tab-btn', '设置');
    await sleep(400);
    await mPage.click('.s-item', '窗口与数据');
    await sleep(400);
    await press(mPage, '[role="radio"]', 'mini窗口');
    await sleep(600);
    await mPage.click('.tab-btn', '首页');
    await sleep(400);

    const tinyMetrics = await sPage.eval(`(() => {
      const btn = document.querySelector('.mini-btn.ins');
      const r = btn?.getBoundingClientRect();
      return {
        isTinyClass: !!document.querySelector('.miniwin.tiny'),
        winW: window.innerWidth,
        winH: window.innerHeight,
        btnW: r ? Math.round(r.width) : null,
        btnH: r ? Math.round(r.height) : null,
      };
    })()`);
    await sPage.shot(join(shots, '12-native-tiny-320x46-plus.png'));
    assert.equal(tinyMetrics.isTinyClass, true);
    assert.equal(tinyMetrics.btnW, 22);
    assert.equal(tinyMetrics.btnH, 26);

    await sPage.click('.mini-btn.ins');
    await sPage.waitFor(`!!document.querySelector('#mini-insert-name')`, 5000, 'tiny insert draft input');
    await sPage.shot(join(shots, '13-native-tiny-320x46-draft.png'));

    // 4f. 测试主窗重载重连（epoch 递增）：小窗未提交草稿在主窗 reload 后自动清理并同步新 epoch
    const epochBeforeReload = await mPage.eval(`window.__TAURI_INTERNALS__ ? true : false`);
    await mPage.eval(`location.reload()`);
    await mPage.waitFor(homeReady, 15_000, 'main reloaded');
    await sPage.waitFor(`!document.querySelector('#mini-insert-name')`, 8000, 'tiny cleared stale draft on main reload');
    await sleep(400);

    // 切回 520×88 标准小窗便于用户查看
    await mPage.click('.tab-btn', '设置');
    await sleep(300);
    await mPage.click('.s-item', '窗口与数据');
    await sleep(300);
    await press(mPage, '[role="radio"]', '小窗口');
    await sleep(400);
    await mPage.click('.tab-btn', '首页');
    await sleep(400);

    assert.equal(mPage.errors.length, 0, `main runtime errors: ${mPage.errors.join('\n')}`);
    assert.equal(sPage.errors.length, 0, `mini runtime errors: ${sPage.errors.join('\n')}`);

    return {
      miniMetrics,
      mirrorInfo,
      draftStillAliveAfterPassiveHide,
      entriesBeforeMiniDraft,
      entriesAfterExplicitClose,
      committedEntry: entriesAfterBgCommit.at(-1),
      tinyMetrics,
      epochBeforeReload,
    };
  },

  async finish() {
    ctx.mini?.close(); ctx.mini = null;
    ctx.main?.close(); ctx.main = null;
    if (!keepAlive) {
      kill(env.exe);
      await sleep(800);
    }
    const after = baseline();
    const before = JSON.parse(await readFile(join(here, 'baseline-before.json'), 'utf8'));
    await writeFile(join(here, 'baseline-after-p7.json'), JSON.stringify(after, null, 2));
    const check = {
      runSame: JSON.stringify(before.run) === JSON.stringify(after.run),
      dailyExeSame: before.daily.exe === after.daily.exe,
      dailyConfigSame: before.daily.config === after.daily.config,
      dailyPid: [before.daily.pid, after.daily.pid],
      isolatedRunningForUser: keepAlive ? count(env.exe) : 0,
    };
    assert.equal(check.runSame, true, 'HKCU Run registry must remain untouched');
    assert.equal(check.dailyExeSame, true, 'Daily executable SHA256 must remain untouched');
    assert.equal(check.dailyConfigSame, true, 'Daily config.json SHA256 must remain untouched');
    return check;
  },
};

let failed = false;
for (const [name, fn] of Object.entries(steps)) {
  const t0 = Date.now();
  try {
    results[name] = { ok: true, ...(await fn()), ms: Date.now() - t0 };
    console.log('PASS', name);
  } catch (error) {
    failed = true;
    results[name] = { ok: false, ms: Date.now() - t0, error: String(error?.stack ?? error) };
    console.error('FAIL', name, error);
    try { await ctx.main?.shot(join(shots, `fail-main-${name}.png`)); } catch {}
    try { await ctx.mini?.shot(join(shots, `fail-mini-${name}.png`)); } catch {}
    break;
  }
  await save();
}
await save();
ctx.mini?.close?.();
ctx.main?.close?.();
if (failed && !keepAlive) kill(env.exe);
process.exit(failed ? 1 : 0);

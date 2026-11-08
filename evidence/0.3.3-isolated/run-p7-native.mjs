import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { baseline, findTarget, listTargetsWithLabels, ps, sleep, waitFor } from './lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const shots = join(here, 'shots');
mkdirSync(shots, { recursive: true });

const env = JSON.parse(readFileSync(join(here, 'env.json'), 'utf8'));
const before = JSON.parse(readFileSync(join(here, 'baseline-before.json'), 'utf8'));
const port = env.cdpPort || 19433;

try {
  ps("Get-Process -Name 'Monorail-0.3.3-isolated' -ErrorAction SilentlyContinue | Stop-Process -Force");
  ps("$k = (Get-Item 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion').OpenSubKey('Run', $true); $k.GetValueNames() | Where-Object { [string]$k.GetValue($_) -like '*Monorail-0.3.3-isolated.exe*' } | ForEach-Object { $k.DeleteValue($_, $false) }; $k.Close()");
} catch {}

// Start with a clean isolated data folder on each run
rmSync(env.data, { recursive: true, force: true });
mkdirSync(env.data, { recursive: true });

function runCli(args, stdinText = undefined) {
  const out = execFileSync(process.execPath, [env.cli, '--json', ...args], {
    env: {
      ...process.env,
      MONORAIL_PIPE: env.pipe,
      MONORAIL_MCP_PIPE: env.pipe,
      MONORAIL_CONFIG_DIR: env.profile,
    },
    input: stdinText,
    encoding: 'utf8',
  });
  return JSON.parse(out.trim());
}

async function setInputValue(page, selector, value) {
  return page.eval(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) throw new Error('Element not found: ' + ${JSON.stringify(selector)});
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return el.value;
  })()`);
}

async function clickButtonByText(page, text, exact = false) {
  return page.eval(`(() => {
    const buttons = [...document.querySelectorAll('button')];
    const btn = buttons.find(b => {
      const t = (b.textContent || '').replace(/\\s+/g, ' ').trim();
      return ${exact ? `t === ${JSON.stringify(text)}` : `t.includes(${JSON.stringify(text)})`};
    });
    if (!btn) {
      throw new Error('Button not found: ' + ${JSON.stringify(text)} + ' among ' + JSON.stringify(buttons.map(b => (b.textContent || '').trim())));
    }
    if (btn.disabled) {
      throw new Error('Button is disabled: ' + ${JSON.stringify(text)});
    }
    btn.click();
    return (btn.textContent || '').trim();
  })()`);
}

const results = {
  startedAt: new Date().toISOString(),
  isolatedEnv: {
    identifier: env.identifier,
    productName: env.productName,
    root: env.root,
    data: env.data,
    profile: env.profile,
    webview: env.webview,
    pipe: env.pipe,
    exe: env.exe,
    cdpPort: port,
  },
  matrix: {},
};

let proc;
let mainPage;

try {
  console.log('1. Spawning isolated debug executable...');
  proc = spawn(env.exe, [], {
    cwd: env.root,
    env: {
      ...process.env,
      MONORAIL_MCP_PIPE: env.pipe,
      MONORAIL_PIPE: env.pipe,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
    },
    stdio: 'ignore',
  });

  mainPage = await findTarget(port, 'main', 30000);
  await waitFor(mainPage, "document.body && document.body.innerText.includes('背包')", 20000);
  await sleep(600);

  // Navigate to Backpack view to observe multi-main-task & ideas
  await clickButtonByText(mainPage, '背包');
  await sleep(400);

  console.log('2. Creating 2 coexisting Main Tasks and 2 Ideas with Markdown details via CLI...');
  const task1Res = runCli([
    'task',
    'create',
    '--name',
    '主线任务 Alpha（0.3.3多主线实测）',
    '--slot',
    '主线',
    '--item',
    '完成想法独立窗口多窗矩阵',
  ]);
  const task2Res = runCli([
    'task',
    'create',
    '--name',
    '主线任务 Beta（0.3.3并存主线）',
    '--slot',
    '主线',
    '--item',
    '验证多主线不互斥并存',
  ]);

  const ideaAMarkdown = [
    '## 核心设计要点',
    '- 第一条列表项',
    '- 第二条列表项',
    '',
    '```ts',
    'const mainLimit = 5;',
    '```',
    '',
    '| 模块 | 状态 |',
    '| --- | --- |',
    '| IdeaWindow | Verified |',
    '',
    '外链测试：[安全链接](https://example.com/alpha) 与 [危险协议](javascript:alert(1))',
  ].join('\n');

  const ideaARes = runCli(
    ['idea', 'create', '--title', '架构笔记 Alpha #架构', '--needs', '整块时间', '--details-stdin'],
    ideaAMarkdown,
  );
  const ideaBRes = runCli(
    ['idea', 'create', '--title', '调研笔记 Beta #调研', '--details-stdin'],
    '## 初始详情\n- 第一条记录',
  );

  const ideaA = ideaARes.result.data.idea;
  const ideaB = ideaBRes.result.data.idea;

  await waitFor(
    mainPage,
    `document.body.innerText.includes('主线任务 Alpha') && document.body.innerText.includes('主线任务 Beta')`,
    10000,
  );
  await mainPage.screenshot(join(shots, '01-main-multi-main-tasks.png'));

  results.matrix.multiMainTasks = {
    passed:
      task1Res.status === 'ok' &&
      task2Res.status === 'ok' &&
      task1Res.result.data.task.slot === '主线' &&
      task2Res.result.data.task.slot === '主线',
    task1Id: task1Res.result.data.task.id,
    task2Id: task2Res.result.data.task.id,
    screenshot: 'shots/01-main-multi-main-tasks.png',
  };

  // =========================================================================
  // Matrix 1: Open / Same-ID Focus / Different-ID Coexistence
  // =========================================================================
  console.log('3. Matrix 1: Open / Same-ID Focus / Different-ID Coexistence...');
  const openA1 = await mainPage.eval(
    `window.__TAURI_INTERNALS__.invoke('open_idea_window', ${JSON.stringify({
      recordId: ideaA.id,
      title: ideaA.title,
    })})`,
  );
  const labelA = `idea-${ideaA.id}`;
  const pageA = await findTarget(port, labelA, 15000);
  await waitFor(
    pageA,
    `document.querySelector('.note-win-title')?.textContent?.includes('架构笔记 Alpha') && document.querySelector('.note-win-read .md-body h2')?.textContent?.includes('核心设计要点')`,
    15000,
  );

  const mdCheckA = await pageA.eval(`(() => {
    const body = document.querySelector('.note-win-read .md-body');
    const links = [...(body?.querySelectorAll('a') || [])].map(a => ({
      text: a.textContent,
      href: a.getAttribute('href'),
    }));
    return {
      hasH2: Boolean(body?.querySelector('h2')),
      hasTable: Boolean(body?.querySelector('table')),
      hasCode: Boolean(body?.querySelector('pre code')),
      links,
      hasJavascriptHref: links.some(l => (l.href || '').toLowerCase().startsWith('javascript:')),
    };
  })()`);
  await pageA.screenshot(join(shots, '02-ideaA-read-markdown.png'));

  // Same-ID second open -> must focus existing window (created: false) and not duplicate
  const openA2 = await mainPage.eval(
    `window.__TAURI_INTERNALS__.invoke('open_idea_window', ${JSON.stringify({
      recordId: ideaA.id,
      title: ideaA.title,
    })})`,
  );
  const targetsAfterSameId = await listTargetsWithLabels(port);
  const countLabelA = targetsAfterSameId.filter(t => t.label === labelA).length;

  // Different-ID open -> must create second independent window (created: true) coexisting with labelA
  const openB1 = await mainPage.eval(
    `window.__TAURI_INTERNALS__.invoke('open_idea_window', ${JSON.stringify({
      recordId: ideaB.id,
      title: ideaB.title,
    })})`,
  );
  const labelB = `idea-${ideaB.id}`;
  const pageB = await findTarget(port, labelB, 15000);
  await waitFor(
    pageB,
    `document.querySelector('.note-win-title')?.textContent?.includes('调研笔记 Beta')`,
    15000,
  );
  const targetsBothOpen = await listTargetsWithLabels(port);
  await pageB.screenshot(join(shots, '03-ideaB-coexisting-window.png'));

  results.matrix.openFocusCoexist = {
    passed:
      (openA1.created === true || openA1.action === 'opened') &&
      (openA1.label === labelA || openA1.windowLabel === labelA) &&
      (openA2.created === false || openA2.action === 'focused') &&
      (openA2.label === labelA || openA2.windowLabel === labelA) &&
      countLabelA === 1 &&
      (openB1.created === true || openB1.action === 'opened') &&
      (openB1.label === labelB || openB1.windowLabel === labelB) &&
      targetsBothOpen.some(t => t.label === labelA) &&
      targetsBothOpen.some(t => t.label === labelB) &&
      mdCheckA.hasH2 &&
      mdCheckA.hasTable &&
      mdCheckA.hasCode &&
      !mdCheckA.hasJavascriptHref,
    openA1,
    openA2,
    countLabelA,
    openB1,
    openTargets: targetsBothOpen.map(t => t.label),
    safeMarkdownRender: mdCheckA,
    screenshots: ['shots/02-ideaA-read-markdown.png', 'shots/03-ideaB-coexisting-window.png'],
  };

  // =========================================================================
  // Matrix 2: Dirty Close 3-Choice Dialog (继续编辑 / 保存并关闭 / 放弃修改并关闭)
  // =========================================================================
  console.log('4. Matrix 2: Dirty Close 3-Choice Dialog...');
  await clickButtonByText(pageB, '编辑', true);
  await waitFor(pageB, "Boolean(document.querySelector('.note-win-ta'))", 5000);
  await setInputValue(pageB, '.note-win-ta', '## 脏关闭三选实测\n- 已修改未保存草稿');
  await sleep(150);

  // Trigger close via Escape or Cancel button (which calls requestClose when dirty)
  await clickButtonByText(pageB, '取消', true);
  await waitFor(
    pageB,
    `document.body.innerText.includes('有未保存的想法笔记修改') && document.body.innerText.includes('继续编辑') && document.body.innerText.includes('放弃修改并关闭') && document.body.innerText.includes('保存并关闭')`,
    5000,
  );
  await pageB.screenshot(join(shots, '04-dirty-close-dialog-3choices.png'));

  // Choice 1: 继续编辑 -> stays open with dirty draft preserved
  await clickButtonByText(pageB, '继续编辑', true);
  await waitFor(pageB, "!document.body.innerText.includes('有未保存的想法笔记修改')", 5000);
  const preservedAfterContinue = await pageB.eval("document.querySelector('.note-win-ta')?.value");

  // Choice 2: 保存并关闭 -> commits to disk and closes window
  await clickButtonByText(pageB, '取消', true);
  await waitFor(pageB, "document.body.innerText.includes('有未保存的想法笔记修改')", 5000);
  await clickButtonByText(pageB, '保存并关闭', true);
  pageB.close();

  // Wait for labelB window to close
  const deadlineCloseB1 = Date.now() + 10000;
  let closedB1 = false;
  while (Date.now() < deadlineCloseB1) {
    const list = await listTargetsWithLabels(port);
    if (!list.some(t => t.label === labelB)) {
      closedB1 = true;
      break;
    }
    await sleep(200);
  }
  const ideaBAfterSaveClose = runCli(['idea', 'show', ideaB.id]).result.idea;

  // Choice 3: Re-open ideaB, edit to make dirty, click 放弃修改并关闭 -> closes without saving
  await mainPage.eval(
    `window.__TAURI_INTERNALS__.invoke('open_idea_window', ${JSON.stringify({
      recordId: ideaB.id,
      title: ideaB.title,
    })})`,
  );
  const pageB2 = await findTarget(port, labelB, 15000);
  await waitFor(pageB2, "document.querySelector('.note-win-title')?.textContent?.includes('调研笔记 Beta')", 10000);
  await clickButtonByText(pageB2, '编辑', true);
  await waitFor(pageB2, "Boolean(document.querySelector('.note-win-ta'))", 5000);
  await setInputValue(pageB2, '.note-win-ta', '## 这段修改会被放弃并不落盘');
  await sleep(150);
  await clickButtonByText(pageB2, '取消', true);
  await waitFor(pageB2, "document.body.innerText.includes('有未保存的想法笔记修改')", 5000);
  await clickButtonByText(pageB2, '放弃修改并关闭', true);
  pageB2.close();

  const deadlineCloseB2 = Date.now() + 10000;
  let closedB2 = false;
  while (Date.now() < deadlineCloseB2) {
    const list = await listTargetsWithLabels(port);
    if (!list.some(t => t.label === labelB)) {
      closedB2 = true;
      break;
    }
    await sleep(200);
  }
  const ideaBAfterDiscardClose = runCli(['idea', 'show', ideaB.id]).result.idea;

  results.matrix.dirtyCloseThreeChoices = {
    passed:
      preservedAfterContinue === '## 脏关闭三选实测\n- 已修改未保存草稿' &&
      closedB1 &&
      ideaBAfterSaveClose.details_markdown === '## 脏关闭三选实测\n- 已修改未保存草稿' &&
      closedB2 &&
      ideaBAfterDiscardClose.details_markdown === '## 脏关闭三选实测\n- 已修改未保存草稿',
    continueEditPreservedDraft: preservedAfterContinue,
    saveAndCloseClosedWindow: closedB1,
    saveAndClosePersistedDetails: ideaBAfterSaveClose.details_markdown,
    discardAndCloseClosedWindow: closedB2,
    discardAndCloseDetailsUnchanged: ideaBAfterDiscardClose.details_markdown,
    screenshot: 'shots/04-dirty-close-dialog-3choices.png',
  };

  // =========================================================================
  // Matrix 3: Save Sync & Stale Revision Conflict (Clean Sync + Conflict Banner)
  // =========================================================================
  console.log('5. Matrix 3: Save Sync & Stale Revision Conflict...');
  // 3a: Clean edit mode receives external committed broadcast -> syncs cleanly without false conflict
  await clickButtonByText(pageA, '编辑', true);
  await waitFor(pageA, "Boolean(document.querySelector('.note-win-ta'))", 5000);
  const extCleanRes = runCli(
    ['idea', 'edit', ideaA.id, '--details-stdin'],
    '## 外部干净同步版本\n- 干净编辑态自动跟随最新修订',
  );
  await waitFor(
    pageA,
    `document.querySelector('.note-win-ta')?.value?.includes('外部干净同步版本')`,
    10000,
  );
  const cleanSyncHasConflictBanner = await pageA.eval("Boolean(document.querySelector('.note-win-conflict'))");

  // 3b: Dirty edit mode receives external update -> shows conflict banner while preserving dirty draft
  await setInputValue(pageA, '.note-win-ta', '## 独立窗口本地脏草稿\n- 我正在独立窗口撰写的长文');
  await sleep(150);
  const extConflictRes = runCli(
    ['idea', 'edit', ideaA.id, '--details-stdin'],
    '## 外部抢先提交的新修订\n- 来自 CLI 的并发更新',
  );
  await waitFor(
    pageA,
    `document.querySelector('.note-win-conflict')?.textContent?.includes('该想法已在其他入口更新')`,
    10000,
  );
  const conflictPreservedLocalDraft = await pageA.eval("document.querySelector('.note-win-ta')?.value");
  await pageA.screenshot(join(shots, '05-ideaA-revision-conflict-banner.png'));

  // Click 基于最新版继续保存, then 保存修改 -> commits local draft on top of latest revision
  await clickButtonByText(pageA, '基于最新版继续保存', true);
  await waitFor(pageA, "!document.querySelector('.note-win-conflict')", 5000);
  await clickButtonByText(pageA, '保存修改', true);
  await waitFor(
    pageA,
    `document.body.innerText.includes('阅读视图') && document.querySelector('.note-win-read')?.innerText?.includes('独立窗口本地脏草稿')`,
    10000,
  );
  const ideaAAfterResolveSave = runCli(['idea', 'show', ideaA.id]).result.idea;

  // 3c: Also verify 加载外部最新版 option in conflict banner
  await clickButtonByText(pageA, '编辑', true);
  await waitFor(pageA, "Boolean(document.querySelector('.note-win-ta'))", 5000);
  await setInputValue(pageA, '.note-win-ta', '## 待被外部最新版覆盖的临时草稿');
  await sleep(150);
  runCli(['idea', 'edit', ideaA.id, '--details-stdin'], '## 外部最新版覆盖验证\n- 点击加载外部最新版后生效');
  await waitFor(
    pageA,
    `document.querySelector('.note-win-conflict')?.textContent?.includes('该想法已在其他入口更新')`,
    10000,
  );
  await clickButtonByText(pageA, '加载外部最新版', true);
  await waitFor(
    pageA,
    `document.querySelector('.note-win-ta')?.value === '## 外部最新版覆盖验证\\n- 点击加载外部最新版后生效' && !document.querySelector('.note-win-conflict')`,
    5000,
  );
  const loadedExternalValue = await pageA.eval("document.querySelector('.note-win-ta')?.value");
  await clickButtonByText(pageA, '取消', true);
  await waitFor(pageA, "document.body.innerText.includes('阅读视图')", 5000);

  results.matrix.saveSyncAndConflict = {
    passed:
      extCleanRes.status === 'ok' &&
      cleanSyncHasConflictBanner === false &&
      extConflictRes.status === 'ok' &&
      conflictPreservedLocalDraft === '## 独立窗口本地脏草稿\n- 我正在独立窗口撰写的长文' &&
      ideaAAfterResolveSave.details_markdown === '## 独立窗口本地脏草稿\n- 我正在独立窗口撰写的长文' &&
      loadedExternalValue === '## 外部最新版覆盖验证\n- 点击加载外部最新版后生效',
    cleanSyncHasConflictBanner,
    conflictPreservedLocalDraft,
    savedDetailsAfterContinueOnLatest: ideaAAfterResolveSave.details_markdown,
    loadedExternalValue,
    screenshot: 'shots/05-ideaA-revision-conflict-banner.png',
  };

  // =========================================================================
  // Matrix 4: QuickBar Draft Handoff, Dual-End Save, Task Clear & Attachments
  // =========================================================================
  console.log('6. Matrix 4: QuickBar Draft Handoff, Dual-End Save, Task Clear & Attachments...');
  await mainPage.eval("window.__TAURI_INTERNALS__.invoke('show_quickbar')");
  const qbPage = await findTarget(port, 'quickbar', 15000);
  await waitFor(qbPage, "Boolean(document.querySelector('.qb-input'))", 10000);

  await setInputValue(qbPage, '.qb-input', 'QuickBar交接测试想法 #交接');
  await clickButtonByText(qbPage, '写详情');
  await waitFor(qbPage, "Boolean(document.querySelector('.qb-detail-ta'))", 5000);
  await setInputValue(qbPage, '.qb-detail-ta', '## 来自 QuickBar 的草稿详情\n- 交接前携带附件与主线项目关联');

  // Select project "主线任务 Alpha" in QuickBar's 所属项目 dropdown
  await qbPage.eval(`(() => {
    const btn = document.querySelector('.sel-btn[aria-label="所属项目"]');
    if (!btn) throw new Error('Project dropdown button not found');
    btn.click();
  })()`);
  await waitFor(qbPage, "Boolean(document.querySelector('.sel-pop'))", 5000);
  await qbPage.eval(`(() => {
    const opts = [...document.querySelectorAll('.sel-pop li[role="option"]')];
    const target = opts.find(li => (li.textContent || '').includes('主线任务 Alpha'));
    if (!target) throw new Error('Option 主线任务 Alpha not found in ' + JSON.stringify(opts.map(o => o.textContent)));
    target.click();
  })()`);
  await waitFor(
    qbPage,
    `document.querySelector('.sel-btn[aria-label="所属项目"]')?.innerText?.includes('主线任务 Alpha')`,
    5000,
  );

  // Synthesize a PNG file drop onto .qb to attach a real image in QuickBar
  await qbPage.eval(`(() => {
    const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const bytes = Uint8Array.from(atob(pngBase64), c => c.charCodeAt(0));
    const file = new File([bytes], 'handoff-attach.png', { type: 'image/png' });
    const dt = new DataTransfer();
    dt.items.add(file);
    const qb = document.querySelector('.qb');
    qb.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
    return true;
  })()`);
  await waitFor(qbPage, "document.querySelector('.qb-files')?.innerText?.includes('handoff-attach.png')", 5000);
  await qbPage.screenshot(join(shots, '06-quickbar-before-handoff.png'));

  // Click 去独立窗口编辑 to handoff draft + attachment + taskId to standalone draft window
  await clickButtonByText(qbPage, '去独立窗口编辑');
  let draftTarget = null;
  const deadlineDraft1 = Date.now() + 15000;
  while (Date.now() < deadlineDraft1) {
    const list = await listTargetsWithLabels(port);
    draftTarget = list.find(t => t.label.startsWith('idea-draft-'));
    if (draftTarget) break;
    await sleep(250);
  }
  if (!draftTarget) throw new Error('Draft window idea-draft-* did not open');

  const draftPage1 = await findTarget(port, draftTarget.label, 10000);
  await waitFor(
    draftPage1,
    `document.querySelector('.note-win-title-inp')?.value === 'QuickBar交接测试想法 #交接' && document.querySelector('.note-win-ta')?.value?.includes('来自 QuickBar 的草稿详情')`,
    10000,
  );
  await draftPage1.screenshot(join(shots, '07-idea-draft-window-opened.png'));

  // Before draftPage1 saves, in QuickBar change 所属项目 to "不属于项目" (explicit taskId: null) and update details
  await qbPage.eval(`(() => {
    const btn = document.querySelector('.sel-btn[aria-label="所属项目"]');
    btn.click();
  })()`);
  await waitFor(qbPage, "Boolean(document.querySelector('.sel-pop'))", 5000);
  await qbPage.eval(`(() => {
    const opts = [...document.querySelectorAll('.sel-pop li[role="option"]')];
    const target = opts.find(li => (li.textContent || '').includes('不属于项目'));
    if (!target) throw new Error('Option 不属于项目 not found');
    target.click();
  })()`);
  await setInputValue(
    qbPage,
    '.qb-detail-ta',
    '## 来自 QuickBar 的草稿详情\n- 独立窗首次保存后，由 QuickBar 端显式清空所属项目关联（taskId=null）',
  );
  await sleep(150);

  // 4a: Save first in standalone draft window -> commits 1 record with task_id = task1Id and attachment
  await setInputValue(
    draftPage1,
    '.note-win-ta',
    '## 来自 QuickBar 的草稿详情\n- 交接前携带附件与主线项目关联\n- 在独立草稿窗完成首次保存',
  );
  await sleep(150);
  await clickButtonByText(draftPage1, '保存想法', true);
  await waitFor(draftPage1, "document.body.innerText.includes('阅读视图')", 10000);

  const findHandoff1 = runCli(['find', '--kind', 'idea', 'QuickBar交接测试想法']);
  const handoff1Items = findHandoff1.result.ideas;
  const handoff1Record = handoff1Items[0];
  const handoff1Full = runCli(['idea', 'show', handoff1Record.id]).result.idea;
  const diskBeforeTaskClear = readFileSync(join(env.data, 'records', `${handoff1Record.id}.md`), 'utf8');
  const hadTaskAssociationInitially = diskBeforeTaskClear.includes(`task_id: ${task1Res.result.data.task.id}`);
  const attachmentDiskExists =
    handoff1Full.attachments.length === 1 && existsSync(join(env.data, handoff1Full.attachments[0]));

  // 4b: Now save in QuickBar (which bound to handoff1Record.id on externalCommitted and has taskId=null)
  await clickButtonByText(qbPage, '保存想法', true);
  await waitFor(qbPage, "document.querySelector('.qb-input')?.value === ''", 10000);

  // Verify draftPage1 received the committed update from QuickBar and disk record now has task_id: null (cleared!) and still 1 record
  await waitFor(
    draftPage1,
    `document.querySelector('.note-win-read')?.innerText?.includes('由 QuickBar 端显式清空所属项目关联')`,
    10000,
  );
  const findAfterQbSave = runCli(['find', '--kind', 'idea', 'QuickBar交接测试想法']);
  const handoffAfterQbItems = findAfterQbSave.result.ideas;
  const handoffAfterQbFull = runCli(['idea', 'show', handoff1Record.id]).result.idea;
  const diskAfterTaskClear = readFileSync(join(env.data, 'records', `${handoff1Record.id}.md`), 'utf8');
  const taskAssociationClearedToNull =
    diskAfterTaskClear.includes('task_id: null') &&
    !diskAfterTaskClear.includes(`task_id: ${task1Res.result.data.task.id}`);

  // Close draftPage1
  await clickButtonByText(draftPage1, '关闭窗口', true);
  draftPage1.close();
  qbPage.close();
  await sleep(400);

  results.matrix.quickbarHandoffAndAttachments = {
    passed:
      handoff1Items.length === 1 &&
      handoffAfterQbItems.length === 1 &&
      handoff1Full.attachments.length === 1 &&
      handoffAfterQbFull.attachments.length === 1 &&
      attachmentDiskExists &&
      hadTaskAssociationInitially &&
      taskAssociationClearedToNull &&
      handoffAfterQbFull.details_markdown ===
        '## 来自 QuickBar 的草稿详情\n- 独立窗首次保存后，由 QuickBar 端显式清空所属项目关联（taskId=null）',
    handoff1CountBeforeQbSave: handoff1Items.length,
    handoff1CountAfterQbSave: handoffAfterQbItems.length,
    handoff1Attachments: handoffAfterQbFull.attachments,
    attachmentDiskExists,
    hadTaskAssociationInitially,
    taskAssociationClearedToNull,
    handoffFinalDetails: handoffAfterQbFull.details_markdown,
    screenshots: ['shots/06-quickbar-before-handoff.png', 'shots/07-idea-draft-window-opened.png'],
  };

  // =========================================================================
  // Matrix 5: Main Window Hidden Background Save & Main Window Reload Stale Epoch Rejection
  // =========================================================================
  console.log('7. Matrix 5: Main Window Hidden Save & Reload Stale Epoch Rejection...');
  // 5a: Hide main window -> save in pageA -> succeeds while main is hidden in background
  await mainPage.eval("window.__TAURI_INTERNALS__.invoke('plugin:window|hide')");
  const mainVisibleWhileHidden = await mainPage.eval("window.__TAURI_INTERNALS__.invoke('plugin:window|is_visible')");

  await clickButtonByText(pageA, '编辑', true);
  await waitFor(pageA, "Boolean(document.querySelector('.note-win-ta'))", 5000);
  await setInputValue(pageA, '.note-win-ta', '## 主窗口隐藏后台时独立窗口成功保存\n- 证明主窗口隐藏不中断单写入者服务');
  await sleep(150);
  await clickButtonByText(pageA, '保存修改', true);
  await waitFor(
    pageA,
    `document.body.innerText.includes('阅读视图') && document.querySelector('.note-win-read')?.innerText?.includes('主窗口隐藏后台时独立窗口成功保存')`,
    10000,
  );
  await pageA.screenshot(join(shots, '08-ideaA-saved-while-main-hidden.png'));

  const ideaADiskAfterHiddenSave = readFileSync(join(env.data, 'records', `${ideaA.id}.md`), 'utf8');
  await mainPage.eval("window.__TAURI_INTERNALS__.invoke('plugin:window|show')");

  // 5b: Reload main window (advances mainEpoch) -> old pageA attempt to save is rejected by epoch guard
  await clickButtonByText(pageA, '编辑', true);
  await waitFor(pageA, "Boolean(document.querySelector('.note-win-ta'))", 5000);
  await setInputValue(pageA, '.note-win-ta', '## 旧 Epoch 窗口写入必须被拒绝');

  await mainPage.eval('location.reload()');
  await sleep(1500);
  mainPage.close();
  mainPage = await findTarget(port, 'main', 20000);
  await waitFor(mainPage, "document.body && document.body.innerText.includes('背包')", 20000);
  await sleep(500);

  await clickButtonByText(pageA, '保存修改', true);
  await waitFor(
    pageA,
    `Boolean(document.querySelector('.note-win-conflict')) && (document.querySelector('.note-win-conflict')?.innerText?.includes('EPOCH_MISMATCH') || document.querySelector('.note-win-conflict')?.innerText?.includes('OUTCOME_UNKNOWN') || document.querySelector('.note-win-conflict')?.innerText?.includes('会话已更新'))`,
    10000,
  );
  const staleEpochErrorText = await pageA.eval("document.querySelector('.note-win-conflict')?.innerText || ''");
  await pageA.screenshot(join(shots, '09-ideaA-stale-epoch-rejected.png'));

  const ideaADiskAfterStaleEpoch = readFileSync(join(env.data, 'records', `${ideaA.id}.md`), 'utf8');

  // Close stale pageA window
  await pageA.eval("window.__TAURI_INTERNALS__.invoke('close_idea_window', {})");
  pageA.close();
  await sleep(400);

  results.matrix.hiddenMainSaveAndStaleEpochReject = {
    passed:
      mainVisibleWhileHidden === false &&
      ideaADiskAfterHiddenSave.includes('主窗口隐藏后台时独立窗口成功保存') &&
      (staleEpochErrorText.includes('EPOCH_MISMATCH') ||
        staleEpochErrorText.includes('OUTCOME_UNKNOWN') ||
        staleEpochErrorText.includes('会话已更新')) &&
      !ideaADiskAfterStaleEpoch.includes('旧 Epoch 窗口写入必须被拒绝'),
    mainVisibleWhileHidden,
    hiddenSavePersistedOnDisk: ideaADiskAfterHiddenSave.includes('主窗口隐藏后台时独立窗口成功保存'),
    staleEpochErrorText,
    staleEpochDidNotOverwriteDisk: !ideaADiskAfterStaleEpoch.includes('旧 Epoch 窗口写入必须被拒绝'),
    screenshots: ['shots/08-ideaA-saved-while-main-hidden.png', 'shots/09-ideaA-stale-epoch-rejected.png'],
  };

  // =========================================================================
  // Matrix 6: Details-Only Dirty Update & Maintenance/Exit Cancel & Restore
  // =========================================================================
  console.log('8. Matrix 6: Details-Only Dirty Update & Maintenance Cancel/Restore...');
  const openAFresh = await mainPage.eval(
    `window.__TAURI_INTERNALS__.invoke('open_idea_window', ${JSON.stringify({
      recordId: ideaA.id,
      title: ideaA.title,
    })})`,
  );
  const pageAFresh = await findTarget(port, labelA, 15000);
  await waitFor(
    pageAFresh,
    `document.querySelector('.note-win-title')?.textContent?.includes('架构笔记 Alpha')`,
    15000,
  );

  // Enter edit mode and modify ONLY detailsMarkdown (leave editTitle completely untouched)
  await clickButtonByText(pageAFresh, '编辑', true);
  await waitFor(pageAFresh, "Boolean(document.querySelector('.note-win-ta'))", 5000);
  const titleBeforeDetailsOnlyEdit = await pageAFresh.eval("document.querySelector('.note-win-title-inp')?.value");
  await setInputValue(
    pageAFresh,
    '.note-win-ta',
    '## 仅修改正文 Dirty 检测与退出取消恢复实测\n- 标题未改动，仅改动 Markdown 详情',
  );
  await sleep(150);

  // Trigger maintenance draft check from main window (same check used by App Exit & Update Install)
  const draftCheckResult = await mainPage.eval(`(async () => {
    try {
      await window.__TAURI_INTERNALS__.invoke('check_drafts_for_maintenance');
      return { dirty: false, blockedMessage: null };
    } catch (err) {
      return { dirty: true, blockedMessage: String(err) };
    }
  })()`);

  const lockedStateDuringCheck = await pageAFresh.eval(`({
    titleDisabled: document.querySelector('.note-win-title-inp')?.disabled,
    detailsDisabled: document.querySelector('.note-win-ta')?.disabled,
  })`);
  await pageAFresh.screenshot(join(shots, '10-ideaA-details-only-dirty-maintenance-locked.png'));

  // Cancel maintenance check (simulating user choosing "取消退出 / 先去处理草稿")
  await mainPage.eval("window.__TAURI_INTERNALS__.invoke('cancel_maintenance_check')");
  await waitFor(pageAFresh, "document.querySelector('.note-win-ta')?.disabled === false", 5000);

  const unlockedStateAfterCancel = await pageAFresh.eval(`({
    titleDisabled: document.querySelector('.note-win-title-inp')?.disabled,
    detailsDisabled: document.querySelector('.note-win-ta')?.disabled,
    titleValue: document.querySelector('.note-win-title-inp')?.value,
    detailsValue: document.querySelector('.note-win-ta')?.value,
  })`);

  // Save the details-only modification after maintenance cancel/restore
  await clickButtonByText(pageAFresh, '保存修改', true);
  await waitFor(
    pageAFresh,
    `document.body.innerText.includes('阅读视图') && document.querySelector('.note-win-read')?.innerText?.includes('仅修改正文 Dirty 检测与退出取消恢复实测')`,
    10000,
  );
  await pageAFresh.screenshot(join(shots, '11-ideaA-maintenance-cancel-restored-and-saved.png'));
  const ideaAAfterDetailsOnlySave = runCli(['idea', 'show', ideaA.id]).result.idea;

  pageAFresh.close();

  results.matrix.detailsOnlyDirtyAndExitCancelRestore = {
    passed:
      draftCheckResult?.dirty === true &&
      lockedStateDuringCheck.titleDisabled === true &&
      lockedStateDuringCheck.detailsDisabled === true &&
      unlockedStateAfterCancel.titleDisabled === false &&
      unlockedStateAfterCancel.detailsDisabled === false &&
      unlockedStateAfterCancel.titleValue === titleBeforeDetailsOnlyEdit &&
      unlockedStateAfterCancel.detailsValue ===
        '## 仅修改正文 Dirty 检测与退出取消恢复实测\n- 标题未改动，仅改动 Markdown 详情' &&
      ideaAAfterDetailsOnlySave.details_markdown ===
        '## 仅修改正文 Dirty 检测与退出取消恢复实测\n- 标题未改动，仅改动 Markdown 详情',
    openAFreshEpoch: openAFresh.mainEpoch,
    draftCheckResult,
    lockedStateDuringCheck,
    unlockedStateAfterCancel,
    savedDetailsAfterRestore: ideaAAfterDetailsOnlySave.details_markdown,
    screenshots: [
      'shots/10-ideaA-details-only-dirty-maintenance-locked.png',
      'shots/11-ideaA-maintenance-cancel-restored-and-saved.png',
    ],
  };
} finally {
  try {
    mainPage?.close();
  } catch {}
  try {
    proc?.kill();
  } catch {}
  try {
    ps("Get-Process -Name 'Monorail-0.3.3-isolated' -ErrorAction SilentlyContinue | Stop-Process -Force");
  } catch {}
  await sleep(1000);
  try {
    ps("$k = (Get-Item 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion').OpenSubKey('Run', $true); $k.GetValueNames() | Where-Object { [string]$k.GetValue($_) -like '*Monorail-0.3.3-isolated.exe*' } | ForEach-Object { $k.DeleteValue($_, $false) }; $k.Close()");
  } catch {}
}

const after = baseline();
writeFileSync(join(here, 'baseline-after-p7.json'), JSON.stringify(after, null, 2), 'utf8');

results.completedAt = new Date().toISOString();
results.baselineComparison = {
  runSame: JSON.stringify(before.run) === JSON.stringify(after.run),
  dailyExeSame: before.daily.exeSha256 === after.daily.exeSha256,
  dailyConfigSame: before.daily.configSha256 === after.daily.configSha256,
  dailyProcessUntouched: JSON.stringify(before.daily.processes) === JSON.stringify(after.daily.processes),
};
results.allPassed =
  Object.values(results.matrix).every(item => item.passed === true) &&
  results.baselineComparison.runSame &&
  results.baselineComparison.dailyExeSame &&
  results.baselineComparison.dailyConfigSame &&
  results.baselineComparison.dailyProcessUntouched;

writeFileSync(join(here, 'results-p7.json'), JSON.stringify(results, null, 2), 'utf8');
console.log(JSON.stringify(results, null, 2));
process.exit(results.allPassed ? 0 : 1);

import { execFileSync, spawn } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertWindowClosedWithMainAlive,
  baseline,
  findTarget,
  postWmCloseToIdeaWindow,
  ps,
  sha256,
  sleep,
  waitFor,
} from './lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');
const shots = join(here, 'shots');
mkdirSync(shots, { recursive: true });

const env = JSON.parse(readFileSync(join(here, 'env.json'), 'utf8'));
const env032 = JSON.parse(readFileSync(join(here, '..', '0.3.2-isolated', 'env.json'), 'utf8'));
const orig032ConfigPath = join(env032.profile, 'config.json');
const orig032ConfigText = existsSync(orig032ConfigPath)
  ? readFileSync(orig032ConfigPath, 'utf8')
  : JSON.stringify({ root: env032.data });
const before = JSON.parse(readFileSync(join(here, 'baseline-before.json'), 'utf8'));
const port033 = env.cdpPort || 19433;
const port032 = 19432;

function fileMeta(p) {
  if (!existsSync(p)) return null;
  const st = statSync(p);
  return {
    path: p,
    sha256: sha256(p),
    sizeBytes: st.size,
    lastWriteTimeUtc: st.mtime.toISOString(),
  };
}

function cleanIsolatedProcessesAndRunKeys() {
  try {
    ps("Get-Process -Name 'Monorail-0.3.3-isolated' -ErrorAction SilentlyContinue | Stop-Process -Force");
    ps("Get-Process -Name 'Monorail-0.3.2-isolated' -ErrorAction SilentlyContinue | Stop-Process -Force");
  } catch {}
  try {
    ps(
      "$k = (Get-Item 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion').OpenSubKey('Run', $true); $k.GetValueNames() | Where-Object { [string]$k.GetValue($_) -like '*Monorail-0.3.*-isolated.exe*' } | ForEach-Object { $k.DeleteValue($_, $false) }; $k.Close()",
    );
  } catch {}
}

function hashDirectory(rootDir) {
  const out = {};
  function walk(dir) {
    const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const full = join(dir, entry.name);
      const rel = relative(rootDir, full).replace(/\\/g, '/');
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && statSync(full).isFile()) {
        out[rel] = sha256(full);
      }
    }
  }
  if (existsSync(rootDir)) walk(rootDir);
  return out;
}

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

cleanIsolatedProcessesAndRunKeys();

const supplement = {
  startedAt: new Date().toISOString(),
  buildAndArtifactBindings: {
    buildCommand: 'node evidence/0.3.3-isolated/setup.mjs --build',
    isolated033Exe: fileMeta(env.exe),
    isolated033Cli: fileMeta(env.cli),
    isolated033Mcp: fileMeta(env.mcp),
    isolated032Exe: fileMeta(env032.exe),
    sourceHashes: {
      'src/services/ideaService.ts': sha256(join(repoRoot, 'src/services/ideaService.ts')),
      'src/services/updateService.ts': sha256(join(repoRoot, 'src/services/updateService.ts')),
      'src/platform/ideaWindows.ts': sha256(join(repoRoot, 'src/platform/ideaWindows.ts')),
      'src/app/IdeaWindowApp.tsx': sha256(join(repoRoot, 'src/app/IdeaWindowApp.tsx')),
      'src/app/QuickBarApp.tsx': sha256(join(repoRoot, 'src/app/QuickBarApp.tsx')),
      'src/app/MainApp.tsx': sha256(join(repoRoot, 'src/app/MainApp.tsx')),
      'src/app/SettingsScreen.tsx': sha256(join(repoRoot, 'src/app/SettingsScreen.tsx')),
      'src/app/BagScreen.tsx': sha256(join(repoRoot, 'src/app/BagScreen.tsx')),
      'src/pages/home/drawer/BagDrawer.tsx': sha256(join(repoRoot, 'src/pages/home/drawer/BagDrawer.tsx')),
      'src/pages/home/drawer/IdeaPool.tsx': sha256(join(repoRoot, 'src/pages/home/drawer/IdeaPool.tsx')),
      'src-tauri/src/idea_windows.rs': sha256(join(repoRoot, 'src-tauri/src/idea_windows.rs')),
      'src-tauri/src/quick_save.rs': sha256(join(repoRoot, 'src-tauri/src/quick_save.rs')),
      'src-tauri/src/updates.rs': sha256(join(repoRoot, 'src-tauri/src/updates.rs')),
      'src-tauri/src/update_state.rs': sha256(join(repoRoot, 'src-tauri/src/update_state.rs')),
      'src-tauri/src/tray.rs': sha256(join(repoRoot, 'src-tauri/src/tray.rs')),
      'src/data/migrations/v3.ts': sha256(join(repoRoot, 'src/data/migrations/v3.ts')),
    },
  },
  items: {},
};

let proc033 = null;
let proc032 = null;

try {
  // ===========================================================================
  // Part A: OS Window Close (Win32 WM_CLOSE -> CloseRequested) Dirty 3-Choice + Clean UI Copy
  //         AND Real App Exit Entry (app-exit-requested -> blocked -> save -> clean exit)
  // ===========================================================================
  rmSync(env.data, { recursive: true, force: true });
  mkdirSync(env.data, { recursive: true });

  console.log('1. Spawning isolated 0.3.3 debug executable for Supplement 1 & 2...');
  proc033 = spawn(env.exe, [], {
    cwd: env.root,
    env: {
      ...process.env,
      MONORAIL_MCP_PIPE: env.pipe,
      MONORAIL_PIPE: env.pipe,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port033}`,
    },
    stdio: 'ignore',
  });

  const mainPage = await findTarget(port033, 'main', 30000);
  await waitFor(mainPage, "document.body && document.body.innerText.includes('背包')", 20000);
  await sleep(500);

  const ideaRes = runCli(
    ['idea', 'create', '--title', 'OS关窗与真实退出实测 #补证', '--needs', '专注时段', '--details-stdin'],
    '## 初始正文\n- 用于验证 OS 级窗口关闭与真实退出入口',
  );
  const idea = ideaRes.result.data.idea;
  const label = `idea-${idea.id}`;

  await mainPage.eval(
    `window.__TAURI_INTERNALS__.invoke('open_idea_window', ${JSON.stringify({
      recordId: idea.id,
      title: idea.title,
    })})`,
  );
  const ideaPage = await findTarget(port033, label, 15000);
  await waitFor(
    ideaPage,
    `document.querySelector('.note-win-title')?.textContent?.includes('OS关窗与真实退出实测')`,
    15000,
  );

  // Verify clean user-facing UI copy (zero engineering jargon)
  const uiCopyCheck = await ideaPage.eval(`(() => {
    const text = document.body.innerText;
    return {
      hasReadViewLabel: text.includes('阅读视图 · 点击链接在浏览器中打开'),
      hasShortcutHint: text.includes('快捷键：Ctrl+Enter 保存 · Esc 关闭'),
      hasSingleWriterJargon: text.includes('Single Writer') || text.includes('baseRevision') || text.includes('sessionEpoch'),
      hasRevJargon: text.includes('基于 REV') || text.includes('ir3:'),
      dockLeftText: document.querySelector('.note-win-dock-left')?.innerText?.trim(),
      dockRightText: document.querySelector('.note-win-dock-right')?.innerText?.trim(),
      topMetaText: document.querySelector('.note-win-topmeta')?.innerText?.trim(),
    };
  })()`);
  await ideaPage.screenshot(join(shots, '12-clean-ui-copy-no-jargon.png'));

  console.log('2. Supplement 1: OS Window Close (Win32 WM_CLOSE -> CloseRequested) Dirty 3-Choice...');
  await clickButtonByText(ideaPage, '编辑', true);
  await waitFor(ideaPage, "Boolean(document.querySelector('.note-win-ta'))", 5000);
  await setInputValue(ideaPage, '.note-win-ta', '## OS 级窗口关闭三选实测\n- 触发真实 Win32 WM_CLOSE / CloseRequested 事件');
  await sleep(150);

  // Trigger genuine Win32 WM_CLOSE (0x0010) on the Idea Window HWND
  const wmClose1 = postWmCloseToIdeaWindow(proc033.pid);
  await waitFor(
    ideaPage,
    `document.body.innerText.includes('有未保存的想法笔记修改') && document.body.innerText.includes('继续编辑') && document.body.innerText.includes('放弃修改并关闭') && document.body.innerText.includes('保存并关闭')`,
    5000,
  );
  await ideaPage.screenshot(join(shots, '13-os-close-dirty-dialog.png'));

  // Choice 1: 继续编辑 -> keeps window open and preserves dirty draft
  await clickButtonByText(ideaPage, '继续编辑', true);
  await waitFor(ideaPage, "!document.body.innerText.includes('有未保存的想法笔记修改')", 5000);
  const draftAfterContinue = await ideaPage.eval("document.querySelector('.note-win-ta')?.value");

  // Trigger Win32 WM_CLOSE again -> Choice 2: 保存并关闭
  const wmClose2 = postWmCloseToIdeaWindow(proc033.pid);
  await waitFor(ideaPage, "document.body.innerText.includes('有未保存的想法笔记修改')", 5000);
  await clickButtonByText(ideaPage, '保存并关闭', true);
  ideaPage.close();

  const closeCheckAfterSave = await assertWindowClosedWithMainAlive(port033, mainPage, label, 10000);
  const afterOsSaveClose = runCli(['idea', 'show', idea.id]).result.idea;

  // Re-open, edit, trigger Win32 WM_CLOSE -> Choice 3: 放弃修改并关闭
  await mainPage.eval(
    `window.__TAURI_INTERNALS__.invoke('open_idea_window', ${JSON.stringify({
      recordId: idea.id,
      title: idea.title,
    })})`,
  );
  const ideaPage2 = await findTarget(port033, label, 15000);
  await waitFor(ideaPage2, "document.querySelector('.note-win-title')?.textContent?.includes('OS关窗与真实退出实测')", 10000);
  await clickButtonByText(ideaPage2, '编辑', true);
  await waitFor(ideaPage2, "Boolean(document.querySelector('.note-win-ta'))", 5000);
  await setInputValue(ideaPage2, '.note-win-ta', '## 这段修改在 OS 关闭时选择放弃');
  await sleep(150);

  const wmClose3 = postWmCloseToIdeaWindow(proc033.pid);
  await waitFor(ideaPage2, "document.body.innerText.includes('有未保存的想法笔记修改')", 5000);
  await clickButtonByText(ideaPage2, '放弃修改并关闭', true);
  ideaPage2.close();

  const closeCheckAfterDiscard = await assertWindowClosedWithMainAlive(port033, mainPage, label, 10000);
  const afterOsDiscardClose = runCli(['idea', 'show', idea.id]).result.idea;

  supplement.items.osCloseDirtyThreeChoicesAndCleanCopy = {
    passed:
      uiCopyCheck.hasReadViewLabel === true &&
      uiCopyCheck.hasShortcutHint === true &&
      uiCopyCheck.hasSingleWriterJargon === false &&
      uiCopyCheck.hasRevJargon === false &&
      draftAfterContinue === '## OS 级窗口关闭三选实测\n- 触发真实 Win32 WM_CLOSE / CloseRequested 事件' &&
      closeCheckAfterSave.closed === true &&
      closeCheckAfterSave.mainAlive === true &&
      afterOsSaveClose.details_markdown === '## OS 级窗口关闭三选实测\n- 触发真实 Win32 WM_CLOSE / CloseRequested 事件' &&
      closeCheckAfterDiscard.closed === true &&
      closeCheckAfterDiscard.mainAlive === true &&
      afterOsDiscardClose.details_markdown === '## OS 级窗口关闭三选实测\n- 触发真实 Win32 WM_CLOSE / CloseRequested 事件',
    uiCopyCheck,
    wmCloseTargets: { wmClose1, wmClose2, wmClose3 },
    draftAfterContinue,
    closeCheckAfterSave,
    persistedAfterSaveClose: afterOsSaveClose.details_markdown,
    closeCheckAfterDiscard,
    persistedAfterDiscardClose: afterOsDiscardClose.details_markdown,
    screenshots: ['shots/12-clean-ui-copy-no-jargon.png', 'shots/13-os-close-dirty-dialog.png'],
  };

  console.log('3. Supplement 2: Real Exit Handler Chain (app-exit-requested emit -> Dirty Block -> Save -> Clean Exit)...');
  await mainPage.eval(
    `window.__TAURI_INTERNALS__.invoke('open_idea_window', ${JSON.stringify({
      recordId: idea.id,
      title: idea.title,
    })})`,
  );
  const ideaPage3 = await findTarget(port033, label, 15000);
  await waitFor(ideaPage3, "document.querySelector('.note-win-title')?.textContent?.includes('OS关窗与真实退出实测')", 10000);
  await clickButtonByText(ideaPage3, '编辑', true);
  await waitFor(ideaPage3, "Boolean(document.querySelector('.note-win-ta'))", 5000);

  // Modify ONLY detailsMarkdown (title untouched)
  await setInputValue(
    ideaPage3,
    '.note-win-ta',
    '## 真实退出处理链（app-exit-requested）拦截后保存再退出\n- 仅修改正文，未改动标题',
  );
  await sleep(150);

  // Verify Tauri command ack_draft_check rejects missing/empty requestId at IPC boundary
  const missingTokenReject = await mainPage.eval(`(async () => {
    try {
      await window.__TAURI_INTERNALS__.invoke('ack_draft_check', { dirty: false });
      return { rejected: false, error: null };
    } catch (err) {
      return { rejected: true, error: String(err?.message ?? err) };
    }
  })()`);
  const emptyTokenReject = await mainPage.eval(`(async () => {
    try {
      await window.__TAURI_INTERNALS__.invoke('ack_draft_check', { requestId: '   ', dirty: false });
      return { rejected: false, error: null };
    } catch (err) {
      return { rejected: true, error: String(err?.message ?? err) };
    }
  })()`);

  // Emit app-exit-requested (triggering MainApp's offExit handler chain: checkDraftsForMaintenance -> catch -> cancelMaintenanceCheck + focusDirtyWindow + report)
  await mainPage.eval(`window.__TAURI_INTERNALS__.invoke('plugin:event|emit_to', {
    target: { kind: 'AnyLabel', label: 'main' },
    event: 'app-exit-requested',
    payload: null,
  })`);

  await waitFor(
    mainPage,
    `document.body.innerText.includes('想法笔记窗口还有未保存内容，请先保存或放弃修改后重试维护操作')`,
    10000,
  );
  await sleep(300);
  const mainToastCheckAfterBlockedExit = await mainPage.eval(`(() => {
    const bodyText = document.body.innerText;
    const toasts = Array.from(document.querySelectorAll('[role="status"], [role="alert"], .toast, .notice'))
      .map(el => el.innerText.trim())
      .filter(Boolean);
    return {
      hasDirtyBlockMessage: bodyText.includes('想法笔记窗口还有未保存内容，请先保存或放弃修改后重试维护操作'),
      hasSpuriousNoPendingError: bodyText.includes('没有等待中的更新草稿检查'),
      hasSpuriousExpiredError: bodyText.includes('草稿检查请求号已过期'),
      hasSpuriousMissingTokenError: bodyText.includes('缺少草稿检查请求号'),
      toasts,
    };
  })()`);
  await mainPage.screenshot(join(shots, '14-real-exit-blocked-toast-on-main.png'));
  await mainPage.screenshot(join(shots, '17-m1-real-exit-blocked-single-toast.png'));

  const processAliveAfterBlockedExit = proc033.exitCode === null;
  const ideaStateAfterBlockedExit = await ideaPage3.eval(`({
    titleDisabled: document.querySelector('.note-win-title-inp')?.disabled,
    detailsDisabled: document.querySelector('.note-win-ta')?.disabled,
    detailsValue: document.querySelector('.note-win-ta')?.value,
  })`);

  // Now save the details-only edit in the Idea Window
  await clickButtonByText(ideaPage3, '保存修改', true);
  await waitFor(
    ideaPage3,
    `document.body.innerText.includes('阅读视图') && document.querySelector('.note-win-read')?.innerText?.includes('真实退出处理链')`,
    10000,
  );
  const diskAfterSaveBeforeCleanExit = readFileSync(join(env.data, 'records', `${idea.id}.md`), 'utf8');

  // Now trigger app-exit-requested again while all windows are clean -> MainApp calls performAppExit() -> app.exit(0)
  const exitPromise = new Promise(resolve => {
    proc033.once('exit', (code, signal) => resolve({ code, signal }));
  });
  await mainPage.eval(`window.__TAURI_INTERNALS__.invoke('plugin:event|emit_to', {
    target: { kind: 'AnyLabel', label: 'main' },
    event: 'app-exit-requested',
    payload: null,
  })`);

  const cleanExitOutcome = await Promise.race([
    exitPromise,
    sleep(10000).then(() => ({ code: 'TIMEOUT', signal: null })),
  ]);
  ideaPage3.close();
  mainPage.close();

  supplement.items.realExitBlockedThenSaveThenCleanExit = {
    passed:
      missingTokenReject.rejected === true &&
      emptyTokenReject.rejected === true &&
      mainToastCheckAfterBlockedExit.hasDirtyBlockMessage === true &&
      mainToastCheckAfterBlockedExit.hasSpuriousNoPendingError === false &&
      mainToastCheckAfterBlockedExit.hasSpuriousExpiredError === false &&
      mainToastCheckAfterBlockedExit.hasSpuriousMissingTokenError === false &&
      processAliveAfterBlockedExit === true &&
      ideaStateAfterBlockedExit.titleDisabled === false &&
      ideaStateAfterBlockedExit.detailsDisabled === false &&
      ideaStateAfterBlockedExit.detailsValue ===
        '## 真实退出处理链（app-exit-requested）拦截后保存再退出\n- 仅修改正文，未改动标题' &&
      diskAfterSaveBeforeCleanExit.includes('真实退出处理链（app-exit-requested）拦截后保存再退出') &&
      cleanExitOutcome.code === 0,
    triggerMechanism: "plugin:event|emit_to('main', 'app-exit-requested') -> MainApp offExit listener -> checkDraftsForMaintenance + performAppExit",
    missingTokenReject,
    emptyTokenReject,
    mainToastCheckAfterBlockedExit,
    processAliveAfterBlockedExit,
    ideaStateAfterBlockedExit,
    cleanExitOutcome,
    screenshot: 'shots/14-real-exit-blocked-toast-on-main.png',
  };

  // ===========================================================================
  // Part B: Supplement 3 — Real 0.3.3 Clean v2->v3 Migration + Old 0.3.2 Isolated EXE
  //         Rejecting v3 Directory (Zero Data Mutation) + Restoring backup/v2-* to Separate Drill Dir
  // ===========================================================================
  console.log('4. Supplement 3: Seeding Schema v2 dataset -> 0.3.3 native v2->v3 migration -> 0.3.2 EXE v3 rejection + v2 backup restore...');
  cleanIsolatedProcessesAndRunKeys();

  // Capture the valid state.yaml, settings.yaml, and today's timelog/*.md initialized in Step 1
  const baseStateYaml = readFileSync(join(env.data, 'state.yaml'), 'utf8').replace(
    /schemaVersion:\s*3/,
    'schemaVersion: 2',
  );
  const baseSettingsYaml = readFileSync(join(env.data, 'settings.yaml'), 'utf8')
    .replace(/schemaVersion:\s*3/, 'schemaVersion: 2')
    .replace(/mainTasks:\s*\d+/, 'mainTasks: 1')
    .replace(/autostart:\s*true/, 'autostart: false');
  const existingTimelogs = readdirSync(join(env.data, 'timelog'))
    .filter(f => f.endsWith('.md'))
    .map(f => ({ name: f, text: readFileSync(join(env.data, 'timelog', f), 'utf8') }));

  rmSync(env.data, { recursive: true, force: true });
  mkdirSync(join(env.data, 'records'), { recursive: true });
  mkdirSync(join(env.data, 'tasks'), { recursive: true });
  mkdirSync(join(env.data, 'cards'), { recursive: true });
  mkdirSync(join(env.data, 'timelog'), { recursive: true });
  mkdirSync(join(env.data, 'reviews'), { recursive: true });

  const v2IdeaId = '11111111-2222-4333-8444-555555555555';
  const v2EntryId = '22222222-3333-4444-8555-666666666666';
  writeFileSync(join(env.data, 'state.yaml'), baseStateYaml, 'utf8');
  writeFileSync(join(env.data, 'settings.yaml'), baseSettingsYaml, 'utf8');
  for (const tl of existingTimelogs) {
    writeFileSync(join(env.data, 'timelog', tl.name), tl.text, 'utf8');
  }
  writeFileSync(
    join(env.data, 'records', `${v2IdeaId}.md`),
    [
      '---',
      `id: ${v2IdeaId}`,
      'text: |-',
      '  旧版v2多行想法首行标题 #迁移实测',
      '  第二行自动拆入v3详情正文',
      '  - 第三行列表项保留',
      'kind: 想法',
      'created_at: "2026-10-01T08:00:00.000Z"',
      'due_at: null',
      'blocking: false',
      'task_id: null',
      'card_id: null',
      'tags:',
      '  - 迁移实测',
      'attachments: []',
      'needs: null',
      'pool: 活跃池',
      'last_touched_at: "2026-10-01T08:00:00.000Z"',
      'cold_since: null',
      '---',
      '旧版v2多行想法首行标题 #迁移实测',
      '第二行自动拆入v3详情正文',
      '- 第三行列表项保留',
      '',
    ].join('\n'),
    'utf8',
  );
  writeFileSync(
    join(env.data, 'timelog', '2026-10-01.md'),
    [
      `- id: ${v2EntryId}`,
      '  started_at: "2026-10-01T09:00:00.000Z"',
      '  ended_at: "2026-10-01T09:30:00.000Z"',
      '  description: v2计时条目保持不变',
      '  project: 未分类',
      '  tags: []',
      '  card_id: null',
      '  kind: 普通',
      '  source: 手动',
      '  updated_at: "2026-10-01T09:30:00.000Z"',
      '',
    ].join('\n'),
    'utf8',
  );

  // Step 4a: Launch 0.3.3 isolated EXE to perform native v2 -> v3 migration & create backup/v2-*
  proc033 = spawn(env.exe, [], {
    cwd: env.root,
    env: {
      ...process.env,
      MONORAIL_MCP_PIPE: env.pipe,
      MONORAIL_PIPE: env.pipe,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port033}`,
    },
    stdio: 'ignore',
  });
  const migratedMainPage = await findTarget(port033, 'main', 30000);
  await waitFor(migratedMainPage, "document.body && document.body.innerText.includes('背包')", 20000);
  await sleep(500);

  const migratedIdea = runCli(['idea', 'show', v2IdeaId]).result.idea;
  const migratedState = readFileSync(join(env.data, 'state.yaml'), 'utf8');
  const migratedSettings = readFileSync(join(env.data, 'settings.yaml'), 'utf8');
  const backupDirs = readdirSync(join(env.data, 'backup')).filter(d => d.startsWith('v2-'));
  const backupRelativePath = `backup/${backupDirs[0]}`;

  // Stop 0.3.3 writer completely before launching 0.3.2
  migratedMainPage.close();
  proc033.kill();
  await sleep(1000);
  cleanIsolatedProcessesAndRunKeys();

  const activeJournalFilesAfterCleanMigration = existsSync(join(env.data, '.journal'))
    ? readdirSync(join(env.data, '.journal')).length
    : 0;

  // Step 4b: Copy clean migrated v3 directory to dedicated v3-drill directory under 0.3.2's authorized fs:scope
  const v3DrillDir = join(env032.data, 'v3-drill');
  const v2RestoredDrillDir = join(env032.data, 'v2-restored-drill');
  rmSync(v3DrillDir, { recursive: true, force: true });
  rmSync(v2RestoredDrillDir, { recursive: true, force: true });
  mkdirSync(v3DrillDir, { recursive: true });
  cpSync(env.data, v3DrillDir, { recursive: true });

  mkdirSync(env032.profile, { recursive: true });
  writeFileSync(orig032ConfigPath, JSON.stringify({ root: v3DrillDir }, null, 2), 'utf8');

  const activeJournalFilesBefore032Open = existsSync(join(v3DrillDir, '.journal'))
    ? readdirSync(join(v3DrillDir, '.journal')).length
    : 0;
  const hashesBefore032OpenV3 = hashDirectory(v3DrillDir);

  proc032 = spawn(env032.exe, [], {
    cwd: env032.root,
    env: {
      ...process.env,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port032}`,
    },
    stdio: 'ignore',
  });
  const page032Reject = await findTarget(port032, 'main', 30000);
  await waitFor(
    page032Reject,
    `document.body && document.body.innerText.includes('打不开这个数据目录')`,
    15000,
  );
  const rejectBodyText = await page032Reject.eval('document.body.innerText');
  await page032Reject.screenshot(join(shots, '15-old-032-exe-rejects-v3-data.png'));
  page032Reject.close();
  proc032.kill();
  await sleep(1000);
  cleanIsolatedProcessesAndRunKeys();

  const activeJournalFilesAfter032Open = existsSync(join(v3DrillDir, '.journal'))
    ? readdirSync(join(v3DrillDir, '.journal')).length
    : 0;
  const hashesAfter032OpenV3 = hashDirectory(v3DrillDir);
  const v3HashesUnchangedAfter032Reject =
    JSON.stringify(hashesBefore032OpenV3) === JSON.stringify(hashesAfter032OpenV3);

  // Step 4c: Restore backup/v2-<timestamp> into separate v2RestoredDrillDir and boot Monorail-0.3.2-isolated.exe
  const backupSourceDir = join(v3DrillDir, 'backup', backupDirs[0]);
  mkdirSync(v2RestoredDrillDir, { recursive: true });
  cpSync(backupSourceDir, v2RestoredDrillDir, { recursive: true });
  writeFileSync(orig032ConfigPath, JSON.stringify({ root: v2RestoredDrillDir }, null, 2), 'utf8');

  proc032 = spawn(env032.exe, [], {
    cwd: env032.root,
    env: {
      ...process.env,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port032}`,
    },
    stdio: 'ignore',
  });
  const page032Restored = await findTarget(port032, 'main', 30000);
  await waitFor(page032Restored, "document.body && document.body.innerText.includes('背包')", 20000);
  await sleep(400);
  await clickButtonByText(page032Restored, '背包');
  await sleep(300);
  await clickButtonByText(page032Restored, '想法池');
  await waitFor(
    page032Restored,
    `document.body.innerText.includes('旧版v2多行想法首行标题')`,
    10000,
  );
  const restoredBodyShowsV2Idea = await page032Restored.eval(
    "document.body.innerText.includes('旧版v2多行想法首行标题')",
  );
  await page032Restored.screenshot(join(shots, '16-old-032-exe-opens-restored-v2-backup.png'));
  page032Restored.close();
  proc032.kill();
  await sleep(1000);

  supplement.items.old032ExeRejectsV3AndRestoresV2Backup = {
    passed:
      migratedState.includes('schemaVersion: 3') &&
      migratedSettings.includes('schemaVersion: 3') &&
      migratedSettings.includes('mainTasks: 2') &&
      migratedIdea.title === '旧版v2多行想法首行标题 #迁移实测' &&
      migratedIdea.details_markdown.trim() === '第二行自动拆入v3详情正文\n- 第三行列表项保留' &&
      backupDirs.length === 1 &&
      activeJournalFilesAfterCleanMigration === 0 &&
      activeJournalFilesBefore032Open === 0 &&
      activeJournalFilesAfter032Open === 0 &&
      Boolean(hashesBefore032OpenV3['state.yaml']) &&
      Boolean(hashesBefore032OpenV3['settings.yaml']) &&
      Boolean(hashesBefore032OpenV3[`records/${v2IdeaId}.md`]) &&
      Boolean(hashesBefore032OpenV3['timelog/2026-10-01.md']) &&
      rejectBodyText.includes('打不开这个数据目录') &&
      v3HashesUnchangedAfter032Reject === true &&
      restoredBodyShowsV2Idea === true,
    scenarioScope: 'clean post-migration v3 directory (no active .journal files)',
    migratedStateSchemaV3: migratedState.includes('schemaVersion: 3'),
    migratedSettingsSchemaV3: migratedSettings.includes('schemaVersion: 3'),
    migratedMainTasksUpgradedTo2: migratedSettings.includes('mainTasks: 2'),
    migratedIdeaTitle: migratedIdea.title,
    migratedIdeaDetails: migratedIdea.details_markdown,
    backupRelativePath,
    v3DrillDir,
    v2RestoredDrillDir,
    activeJournalFilesAfterCleanMigration,
    activeJournalFilesBefore032Open,
    activeJournalFilesAfter032Open,
    old032RejectMessage: rejectBodyText.split('\n').find(l => l.includes('打不开这个数据目录')) || rejectBodyText,
    v3HashesBefore032Open: hashesBefore032OpenV3,
    v3HashesAfter032Open: hashesAfter032OpenV3,
    v3HashesUnchangedAfter032Reject,
    restoredBodyShowsV2Idea,
    screenshots: [
      'shots/15-old-032-exe-rejects-v3-data.png',
      'shots/16-old-032-exe-opens-restored-v2-backup.png',
    ],
  };
} finally {
  try {
    writeFileSync(orig032ConfigPath, orig032ConfigText, 'utf8');
  } catch {}
  cleanIsolatedProcessesAndRunKeys();
  await sleep(800);
  cleanIsolatedProcessesAndRunKeys();
}

const after = baseline();
writeFileSync(join(here, 'baseline-after-supplement.json'), JSON.stringify(after, null, 2), 'utf8');

supplement.completedAt = new Date().toISOString();
supplement.baselineComparison = {
  runSame: JSON.stringify(before.run) === JSON.stringify(after.run),
  dailyExeSame: before.daily.exeSha256 === after.daily.exeSha256,
  dailyConfigSame: before.daily.configSha256 === after.daily.configSha256,
  dailyProcessUntouched: JSON.stringify(before.daily.processes) === JSON.stringify(after.daily.processes),
};
supplement.allPassed =
  Object.values(supplement.items).every(item => item.passed === true) &&
  supplement.baselineComparison.runSame &&
  supplement.baselineComparison.dailyExeSame &&
  supplement.baselineComparison.dailyConfigSame &&
  supplement.baselineComparison.dailyProcessUntouched;

writeFileSync(join(here, 'results-p7-supplement.json'), JSON.stringify(supplement, null, 2), 'utf8');
writeFileSync(join(here, 'results-p7-m1-reverify.json'), JSON.stringify(supplement, null, 2), 'utf8');
console.log(JSON.stringify(supplement, null, 2));
process.exit(supplement.allPassed ? 0 : 1);

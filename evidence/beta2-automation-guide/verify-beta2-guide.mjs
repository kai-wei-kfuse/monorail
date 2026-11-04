import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { stringify } from 'yaml';
import { defaults as v1Defaults } from '../../src/data/migrations/v1/settings.ts';

const repoRoot = resolve('.');
const evidenceDir = resolve('evidence/beta2-automation-guide');
const workDir = resolve('src-tauri/target/beta2-guide-work');
const sharedTargetDir = resolve('src-tauri/target');

const ISOLATED_PRODUCT_NAME = '单轨Beta2说明页验收';
const ISOLATED_IDENTIFIER = 'local.pixelrecord.beta2-guide-test';
// Non-default installation directory containing Chinese characters, spaces, and parentheses
const customInstallDir = join(evidenceDir, '隔离安装 目录 (Beta 2)');
const isolatedDataDir = join(evidenceDir, '隔离数据 目录 (Beta 2)');
const isolatedExePath = join(customInstallDir, 'pixel-record.exe');
const isolatedMcpPath = join(customInstallDir, 'monorail-mcp.mjs');
const isolatedCliPath = join(customInstallDir, 'monorail-cli.mjs');
const isolatedConfigDir = join(process.env.APPDATA, ISOLATED_IDENTIFIER);
const isolatedWebViewDir = join(process.env.LOCALAPPDATA, ISOLATED_IDENTIFIER);
const isolatedPipe = `\\\\.\\pipe\\${ISOLATED_IDENTIFIER}.mcp`;

const dailyExePath = join(process.env.LOCALAPPDATA, '单轨', 'pixel-record.exe');
const dailyConfigPath = join(process.env.APPDATA, 'local.pixelrecord.app', 'config.json');
const CDP_PORT = 19349;

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function sha256File(path) {
  const bytes = await readFile(path);
  return createHash('sha256').update(bytes).digest('hex');
}

function getRunRegistryAndDailySnapshot() {
  const ps = `
$OutputEncoding = [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$runKey = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'
$props = Get-ItemProperty -Path $runKey
$runEntries = @{}
foreach ($p in $props.PSObject.Properties) {
  if ($p.Name -notlike 'PS*') {
    $runEntries[$p.Name] = [string]$p.Value
  }
}
$dailyExe = '${dailyExePath.replaceAll("'", "''")}'
$dailyCfg = '${dailyConfigPath.replaceAll("'", "''")}'
$proc = Get-Process -Name 'pixel-record' -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $dailyExe } | Select-Object -First 1
@{
  runEntries = $runEntries
  dailyApp = @{
    runningPid = if ($proc) { $proc.Id } else { $null }
    exeSha256 = if (Test-Path $dailyExe) { (Get-FileHash $dailyExe -Algorithm SHA256).Hash.ToLower() } else { $null }
    configSha256 = if (Test-Path $dailyCfg) { (Get-FileHash $dailyCfg -Algorithm SHA256).Hash.ToLower() } else { $null }
  }
} | ConvertTo-Json -Depth 5 -Compress
`;
  const raw = execFileSync('powershell.exe', ['-NoProfile', '-Command', ps], { encoding: 'utf8' }).trim();
  return JSON.parse(raw);
}

function removeTestRunRegistryEntryIfAny(beforeRunEntries = {}) {
  const hadBefore = Object.prototype.hasOwnProperty.call(beforeRunEntries, ISOLATED_PRODUCT_NAME);
  const ps = `
$runKey = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'
$hadBefore = $${hadBefore ? 'true' : 'false'}
$targetName = '${ISOLATED_PRODUCT_NAME}'
$targetExe = '${isolatedExePath.replaceAll("'", "''")}'
if (-not $hadBefore) {
  $props = Get-ItemProperty -Path $runKey -ErrorAction SilentlyContinue
  if ($props -and ($null -ne $props.$targetName)) {
    $val = [string]$props.$targetName
    if ($val -eq $targetExe -or $val -eq ('"' + $targetExe + '"')) {
      Remove-ItemProperty -Path $runKey -Name $targetName -ErrorAction SilentlyContinue
    }
  }
}
Remove-Item -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${ISOLATED_PRODUCT_NAME}' -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -Path 'HKCU:\\Software\\pixelrecord\\${ISOLATED_PRODUCT_NAME}' -Recurse -Force -ErrorAction SilentlyContinue
$startMenu = Join-Path $env:APPDATA 'Microsoft\\Windows\\Start Menu\\Programs\\${ISOLATED_PRODUCT_NAME}.lnk'
$desktop = Join-Path ([Environment]::GetFolderPath('Desktop')) '${ISOLATED_PRODUCT_NAME}.lnk'
Remove-Item -Path $startMenu -Force -ErrorAction SilentlyContinue
Remove-Item -Path $desktop -Force -ErrorAction SilentlyContinue
`;
  execFileSync('powershell.exe', ['-NoProfile', '-Command', ps], { stdio: 'ignore' });
}

function setWindowsClipboard(text) {
  execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-Sta',
      '-Command',
      `Set-Clipboard -Value '${text.replaceAll("'", "''")}'`,
    ],
    { stdio: 'ignore' },
  );
}

function getWindowsClipboard() {
  return execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-Sta',
      '-Command',
      '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Get-Clipboard -Raw',
    ],
    { encoding: 'utf8' },
  ).replace(/\r\n$/, '');
}

function killIsolatedApp() {
  const ps = `
Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq '${isolatedExePath.replaceAll("'", "''")}' } | ForEach-Object {
  Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
}
`;
  try {
    execFileSync('powershell.exe', ['-NoProfile', '-Command', ps], { stdio: 'ignore' });
  } catch {}
}

async function connectMainCdp() {
  for (let attempt = 0; attempt < 60; attempt++) {
    let targets = [];
    try {
      const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json`);
      targets = (await res.json()).filter(t => t.type === 'page' && t.webSocketDebuggerUrl);
    } catch {}
    for (const candidate of targets) {
      const ws = new WebSocket(candidate.webSocketDebuggerUrl);
      try {
        await new Promise((resolveOpen, rejectOpen) => {
          ws.addEventListener('open', resolveOpen, { once: true });
          ws.addEventListener('error', rejectOpen, { once: true });
        });
        let msgId = 0;
        const callCdp = (method, params = {}) =>
          new Promise((resolveCall, rejectCall) => {
            const id = ++msgId;
            const onMessage = event => {
              const data = JSON.parse(String(event.data));
              if (data.id === id) {
                ws.removeEventListener('message', onMessage);
                if (data.error) rejectCall(new Error(data.error.message));
                else resolveCall(data.result);
              }
            };
            ws.addEventListener('message', onMessage);
            ws.send(JSON.stringify({ id, method, params }));
          });
        const evalRes = await callCdp('Runtime.evaluate', {
          expression: 'window.__TAURI_INTERNALS__?.metadata?.currentWindow?.label',
          returnByValue: true,
        });
        if (evalRes?.result?.value === 'main') {
          await callCdp('Page.enable');
          return { ws, callCdp };
        }
      } catch {}
      try {
        ws.close();
      } catch {}
    }
    await sleep(250);
  }
  throw new Error(`Unable to connect to WebView2 CDP 'main' target on port ${CDP_PORT}`);
}

async function captureScreenshot(callCdp, outPath) {
  await callCdp('Runtime.evaluate', {
    expression: `(() => { document.querySelectorAll('.toast-host, .toasts').forEach(el => { el.style.display = 'none'; }); })()`,
  });
  await sleep(200);
  const shot = await callCdp('Page.captureScreenshot', { format: 'png' });
  const bytes = Buffer.from(shot.data, 'base64');
  await writeFile(outPath, bytes);
  const info = await stat(outPath);
  assert.ok(info.size > 20_000, `Screenshot ${outPath} is too small (${info.size} bytes)`);
  return info.size;
}

await mkdir(evidenceDir, { recursive: true });
await mkdir(workDir, { recursive: true });

const beforeSnapshot = getRunRegistryAndDailySnapshot();
await writeFile(join(evidenceDir, 'run-registry-before.json'), JSON.stringify(beforeSnapshot, null, 2) + '\n', 'utf8');

try {
  killIsolatedApp();
  await rm(customInstallDir, { recursive: true, force: true });
  await rm(isolatedDataDir, { recursive: true, force: true });
  await rm(isolatedConfigDir, { recursive: true, force: true });
  await rm(isolatedWebViewDir, { recursive: true, force: true });

  await mkdir(isolatedDataDir, { recursive: true });
  await mkdir(isolatedConfigDir, { recursive: true });

  // Pre-seed settings.yaml with autostart: false and isolated hotkeys BEFORE first launch!
  await writeFile(
    join(isolatedDataDir, 'settings.yaml'),
    stringify({
      ...v1Defaults,
      autostart: false,
      quickbarHotkey: 'Ctrl+Alt+Shift+F11',
      mainHotkey: 'Ctrl+Alt+Shift+F12',
    }),
    'utf8',
  );
  await writeFile(
    join(isolatedConfigDir, 'config.json'),
    JSON.stringify({ root: isolatedDataDir }),
    'utf8',
  );

  const installerPath = join(
    sharedTargetDir,
    `debug/bundle/nsis/${ISOLATED_PRODUCT_NAME}_0.3.0-beta.2_x64-setup.exe`,
  );
  let installerExists = false;
  try {
    installerExists = (await stat(installerPath)).isFile();
  } catch {}
  if (!installerExists) {
    // 1. Build frontend & bundles
    console.log('Building frontend and MCP/CLI bundles...');
    execFileSync(process.execPath, ['scripts/build-mcp.mjs'], { cwd: repoRoot, stdio: 'inherit' });
    execFileSync(process.execPath, [resolve('node_modules/vite/bin/vite.js'), 'build'], {
      cwd: repoRoot,
      stdio: 'inherit',
    });

    // 2. Build isolated NSIS installer for 0.3.0-beta.2
    const baseConfig = JSON.parse(await readFile('src-tauri/tauri.conf.json', 'utf8'));
    baseConfig.productName = ISOLATED_PRODUCT_NAME;
    baseConfig.identifier = ISOLATED_IDENTIFIER;
    baseConfig.build.beforeBuildCommand = null;
    baseConfig.bundle.createUpdaterArtifacts = false;
    const mainWin = baseConfig.app.windows.find(w => w.label === 'main');
    if (mainWin) mainWin.title = `${ISOLATED_PRODUCT_NAME} v0.3.0-beta.2`;
    baseConfig.app.security.capabilities.push({
      identifier: 'beta2-guide-data-scope',
      windows: ['main', 'quickbar', 'mini'],
      permissions: [
        {
          identifier: 'fs:scope',
          allow: [{ path: isolatedDataDir }, { path: join(isolatedDataDir, '**') }],
        },
      ],
    });
    const cfgPath = join(workDir, 'tauri.beta2-guide.json');
    await writeFile(cfgPath, JSON.stringify(baseConfig, null, 2), 'utf8');

    const tauriCli = resolve('node_modules/@tauri-apps/cli/tauri.js');
    console.log('Building isolated NSIS installer...');
    execFileSync(process.execPath, [tauriCli, 'build', '-d', '-b', 'nsis', '-c', cfgPath], {
      cwd: repoRoot,
      stdio: 'inherit',
    });
  } else {
    console.log('Reusing built isolated NSIS installer:', installerPath);
  }
  const copiedInstallerPath = join(evidenceDir, `${ISOLATED_PRODUCT_NAME}_0.3.0-beta.2_x64-setup.exe`);
  await cp(installerPath, copiedInstallerPath, { force: true });

  // 3. Install into non-default directory with Chinese characters, spaces, and parentheses
  // Note: In NSIS, /D=... must be the last parameter and unquoted on the raw command line
  console.log(`Installing into custom path: ${customInstallDir}`);
  execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-Command',
      `Start-Process -FilePath '${copiedInstallerPath.replaceAll("'", "''")}' -ArgumentList '/S', ('/D=' + '${customInstallDir.replaceAll("'", "''")}') -Wait`,
    ],
    { stdio: 'inherit' },
  );

  assert.ok((await stat(isolatedExePath)).isFile(), 'Isolated executable must exist in custom install dir');
  assert.ok((await stat(isolatedMcpPath)).isFile(), 'Bundled monorail-mcp.mjs must exist in custom install dir');
  assert.ok((await stat(isolatedCliPath)).isFile(), 'Bundled monorail-cli.mjs must exist in custom install dir');

  // 4. Launch the installed isolated app with WebView2 CDP enabled
  console.log('Launching isolated installed app...');
  const appProc = spawn(isolatedExePath, [], {
    cwd: customInstallDir,
    env: {
      ...process.env,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${CDP_PORT}`,
    },
    detached: true,
    stdio: 'ignore',
  });
  appProc.unref();

  const { ws, callCdp } = await connectMainCdp();
  try {
    // Wait for MainApp shell to finish bootstrap
    for (let i = 0; i < 120; i++) {
      const evalText = await callCdp('Runtime.evaluate', {
        expression: 'document.body?.innerText ?? ""',
        returnByValue: true,
      });
      const text = String(evalText?.result?.value ?? '');
      if (text.includes('首页') && text.includes('设置') && !text.includes('正在打开数据目录')) {
        break;
      }
      await sleep(150);
    }
    await sleep(400);

    // Bring main window to foreground so WebView2 navigator.clipboard.writeText has focused document + userGesture
    await callCdp('Page.bringToFront');

    // Navigate to Settings -> 09 AI 与自动化
    await callCdp('Runtime.evaluate', {
      expression: `(() => {
        const tabs = Array.from(document.querySelectorAll('button.tab-btn, nav.tabs button'));
        const st = tabs.find(el => (el.textContent ?? '').includes('设置'));
        if (st) st.click();
      })()`,
      userGesture: true,
    });
    await sleep(350);

    await callCdp('Runtime.evaluate', {
      expression: `(() => {
        const items = Array.from(document.querySelectorAll('button.s-item, nav.s-nav button'));
        const autoBtn = items.find(el => (el.textContent ?? '').includes('AI 与自动化'));
        if (autoBtn) autoBtn.click();
      })()`,
      userGesture: true,
    });

    // Wait for read_mcp_host to populate the real paths
    for (let i = 0; i < 40; i++) {
      const checkRes = await callCdp('Runtime.evaluate', {
        expression: 'document.querySelector(".st-auto")?.innerText ?? ""',
        returnByValue: true,
      });
      if (String(checkRes?.result?.value ?? '').includes('monorail-mcp.mjs')) break;
      await sleep(100);
    }
    await sleep(300);

    // Screenshot 1: Top of 09 AI 与自动化 (OVERVIEW)
    await captureScreenshot(callCdp, join(evidenceDir, 'ui-01-automation-overview.png'));

    // Scroll to MCP 配置 (MCP CONFIG), click "复制 MCP 配置" with real userGesture, and read back from Windows system clipboard
    setWindowsClipboard('__SENTINEL_MCP_STDIO__');
    await callCdp('Runtime.evaluate', {
      expression: `(() => {
        window.focus();
        const groups = Array.from(document.querySelectorAll('.st-auto .s-group'));
        const mcpGroup = groups.find(g => (g.textContent ?? '').includes('MCP 配置'));
        if (mcpGroup) mcpGroup.scrollIntoView({ behavior: 'instant', block: 'start' });
        const btns = Array.from(document.querySelectorAll('.st-auto button'));
        const copyMcp = btns.find(b => (b.textContent ?? '').trim() === '复制 MCP 配置');
        if (!copyMcp) throw new Error('Missing 复制 MCP 配置 button');
        copyMcp.focus();
        copyMcp.click();
        const details = document.querySelector('.st-auto-sub');
        if (details) details.open = true;
      })()`,
      userGesture: true,
    });
    await sleep(300);

    const mcpUiCheck = await callCdp('Runtime.evaluate', {
      expression: 'document.querySelector(".st-auto")?.innerText ?? ""',
      returnByValue: true,
    });
    const mcpUiText = String(mcpUiCheck?.result?.value ?? '');
    assert.ok(mcpUiText.includes('已复制 MCP 配置 ✓'), `Expected UI to show 已复制 MCP 配置 ✓, got: ${mcpUiText}`);
    const copiedMcpJson = getWindowsClipboard().trim();
    assert.notEqual(copiedMcpJson, '__SENTINEL_MCP_STDIO__', 'System clipboard must be updated by 复制 MCP 配置');

    await captureScreenshot(callCdp, join(evidenceDir, 'ui-02-automation-mcp-config.png'));

    // Click optional HTTP copy button with real userGesture and read back from Windows system clipboard
    setWindowsClipboard('__SENTINEL_MCP_HTTP__');
    await callCdp('Runtime.evaluate', {
      expression: `(() => {
        window.focus();
        const httpBtn = document.querySelector('.st-auto-sub button');
        if (!httpBtn) throw new Error('Missing HTTP copy button');
        httpBtn.focus();
        httpBtn.click();
      })()`,
      userGesture: true,
    });
    await sleep(250);
    const httpUiCheck = await callCdp('Runtime.evaluate', {
      expression: 'document.querySelector(".st-auto-sub")?.innerText ?? ""',
      returnByValue: true,
    });
    assert.ok(
      String(httpUiCheck?.result?.value ?? '').includes('已复制 HTTP 启动命令 ✓'),
      'Expected UI to show 已复制 HTTP 启动命令 ✓',
    );
    const copiedHttpCommand = getWindowsClipboard().trim();
    assert.notEqual(copiedHttpCommand, '__SENTINEL_MCP_HTTP__', 'System clipboard must be updated by HTTP copy button');

    // Scroll to CLI examples section and click each of the 6 CLI copy buttons one by one, reading back real Windows system clipboard each time
    await callCdp('Runtime.evaluate', {
      expression: `(() => {
        const groups = Array.from(document.querySelectorAll('.st-auto .s-group'));
        const cliGroup = groups.find(g => (g.textContent ?? '').includes('CLI 命令'));
        if (cliGroup) cliGroup.scrollIntoView({ behavior: 'instant', block: 'start' });
      })()`,
    });
    await sleep(250);

    const copiedCliCommands = [];
    for (let idx = 0; idx < 6; idx++) {
      const sentinel = `__SENTINEL_CLI_${idx}__`;
      setWindowsClipboard(sentinel);
      await callCdp('Runtime.evaluate', {
        expression: `(() => {
          window.focus();
          const cliBtns = Array.from(document.querySelectorAll('.st-auto-cli-list button'));
          const btn = cliBtns[${idx}];
          if (!btn) throw new Error('Missing CLI copy button at index ${idx}');
          btn.focus();
          btn.click();
        })()`,
        userGesture: true,
      });
      await sleep(200);
      const clipText = getWindowsClipboard().trim();
      assert.notEqual(clipText, sentinel, `System clipboard must be updated by CLI copy button ${idx}`);
      copiedCliCommands.push(clipText);
    }
    // Click the first CLI copy button once more so ui-03 screenshot visibly shows "已复制「读取当前上下文与待处理通知」命令 ✓" at the top of the CLI list
    await callCdp('Runtime.evaluate', {
      expression: `(() => {
        window.focus();
        const cliBtns = Array.from(document.querySelectorAll('.st-auto-cli-list button'));
        if (cliBtns[0]) { cliBtns[0].focus(); cliBtns[0].click(); }
      })()`,
      userGesture: true,
    });
    await sleep(250);

    await captureScreenshot(callCdp, join(evidenceDir, 'ui-03-automation-cli-examples.png'));

    // Scroll to Troubleshooting at the bottom
    await callCdp('Runtime.evaluate', {
      expression: `(() => {
        const p = document.querySelector('.s-panel');
        if (p) p.scrollTop = p.scrollHeight;
      })()`,
    });
    await sleep(300);

    await captureScreenshot(callCdp, join(evidenceDir, 'ui-04-automation-troubleshooting.png'));

    // Verify C3: Missing / broken path behavior in real installed UI
    await rename(isolatedMcpPath, `${isolatedMcpPath}.bak`);
    await rename(isolatedCliPath, `${isolatedCliPath}.bak`);
    try {
      await callCdp('Runtime.evaluate', {
        expression: `(() => {
          const p = document.querySelector('.s-panel');
          if (p) p.scrollTop = 0;
          const btns = Array.from(document.querySelectorAll('.st-auto button'));
          const refreshBtn = btns.find(b => (b.textContent ?? '').trim() === '重新检测路径');
          if (refreshBtn) refreshBtn.click();
        })()`,
      });
      await sleep(400);

      // Scroll slightly to show the MCP missing-path alert clearly
      await callCdp('Runtime.evaluate', {
        expression: `(() => {
          const alertEl = document.querySelector('.st-auto-alert');
          if (alertEl) alertEl.scrollIntoView({ behavior: 'instant', block: 'center' });
        })()`,
      });
      await sleep(250);

      const missingStateRes = await callCdp('Runtime.evaluate', {
        expression: `JSON.stringify({
          text: document.querySelector('.st-auto')?.innerText ?? '',
          disabledCopyCount: Array.from(document.querySelectorAll('.st-auto button')).filter(b => {
            const t = (b.textContent ?? '').trim();
            return (t === '复制 MCP 配置' || t === '复制') && b.disabled;
          }).length
        })`,
        returnByValue: true,
      });
      const missingState = JSON.parse(String(missingStateRes?.result?.value ?? '{}'));
      assert.ok(missingState.text.includes('无法生成 MCP 配置（不使用猜测路径）'));
      assert.ok(missingState.text.includes('无法生成可执行 CLI 命令（不使用猜测路径）'));
      assert.ok(missingState.text.includes('请从托盘完全退出单轨后重新启动'));
      assert.ok(missingState.text.includes('再重新启动开发应用以刷新入口登记'));
      assert.equal(missingState.disabledCopyCount, 8, 'All 8 copy buttons must be disabled when paths are missing');

      await captureScreenshot(callCdp, join(evidenceDir, 'ui-05-automation-missing-path-error.png'));
    } finally {
      await rename(`${isolatedMcpPath}.bak`, isolatedMcpPath);
      await rename(`${isolatedCliPath}.bak`, isolatedCliPath);
    }

    // Refresh paths back to valid state
    await callCdp('Runtime.evaluate', {
      expression: `(() => {
        const btns = Array.from(document.querySelectorAll('.st-auto button'));
        const refreshBtn = btns.find(b => (b.textContent ?? '').trim() === '重新检测路径');
        if (refreshBtn) refreshBtn.click();
      })()`,
    });
    await sleep(350);

    // Check section 10 "关于"
    await callCdp('Runtime.evaluate', {
      expression: `(() => {
        const items = Array.from(document.querySelectorAll('button.s-item, nav.s-nav button'));
        const aboutBtn = items.find(el => (el.textContent ?? '').includes('关于'));
        if (aboutBtn) aboutBtn.click();
      })()`,
    });
    await sleep(350);
    await captureScreenshot(callCdp, join(evidenceDir, 'ui-06-about-section-10.png'));

    // 5. C4: Execute real MCP tool calls using the exact MCP JSON copied from the Settings UI
    console.log('Verifying real MCP tool call using copied MCP config JSON...');
    const parsedMcpConfig = JSON.parse(copiedMcpJson);
    const serverEntry = parsedMcpConfig.mcpServers?.monorail;
    assert.ok(serverEntry, 'Copied MCP JSON must contain mcpServers.monorail');
    assert.equal(serverEntry.command, 'node');
    assert.deepEqual(serverEntry.args, [isolatedMcpPath]);

    const mcpClient = new Client({ name: 'beta2-guide-verifier', version: '0.3.0-beta.2' });
    const mcpTransport = new StdioClientTransport({
      command: serverEntry.command,
      args: serverEntry.args,
      env: {
        ...process.env,
        MONORAIL_PIPE: isolatedPipe,
        MONORAIL_CONFIG_DIR: isolatedConfigDir,
        MONORAIL_EXECUTABLE: isolatedExePath,
      },
      stderr: 'pipe',
    });
    await mcpClient.connect(mcpTransport);
    let mcpContextResult;
    let mcpSaveIdeaResult;
    let mcpFindResult;
    try {
      // Read-only first
      const ctxCall = await mcpClient.callTool({ name: 'get_context', arguments: {} });
      assert.ok(!ctxCall.isError, 'MCP get_context should succeed');
      mcpContextResult = ctxCall.structuredContent;
      assert.ok(mcpContextResult?.operation_id, 'MCP get_context must issue operation_id');

      // Dedicated test write
      const saveCall = await mcpClient.callTool({
        name: 'save_idea',
        arguments: {
          operation_id: mcpContextResult.operation_id,
          text: 'Beta2 设置页复制 MCP 配置实测想法 #验收',
          needs: '验证复制出的中文空格路径配置可直接连通',
        },
      });
      assert.ok(!saveCall.isError, 'MCP save_idea should succeed');
      mcpSaveIdeaResult = saveCall.structuredContent;
      assert.equal(mcpSaveIdeaResult?.status, 'committed');

      const findCall = await mcpClient.callTool({
        name: 'find_items',
        arguments: { kind: 'idea', query: 'Beta2 设置页复制 MCP 配置实测想法' },
      });
      assert.ok(!findCall.isError, 'MCP find_items should succeed');
      mcpFindResult = findCall.structuredContent;
      assert.equal(mcpFindResult?.ideas?.length, 1);
    } finally {
      await mcpClient.close();
    }

    // 6. C4: Execute the exact PowerShell CLI commands copied from the Settings UI
    console.log('Verifying real PowerShell CLI execution using copied CLI commands...');
    const runCopiedPowerShellCommand = cmdText => {
      const psScript = `
$OutputEncoding = [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$env:MONORAIL_PIPE = '${isolatedPipe.replaceAll("'", "''")}'
$env:MONORAIL_CONFIG_DIR = '${isolatedConfigDir.replaceAll("'", "''")}'
$env:MONORAIL_EXECUTABLE = '${isolatedExePath.replaceAll("'", "''")}'
${cmdText}
`;
      return execFileSync('powershell.exe', ['-NoProfile', '-Command', psScript], {
        encoding: 'utf8',
      }).trim();
    };

    // Order of CLI examples in UI:
    // 0: context --json (read-only first)
    // 1: idea add '整理季度复盘提纲 #规划' --json
    // 2: time summary --day today --json
    // 3: timer start '撰写技术方案' --json
    // 4: timer stop --json
    // 5: --help
    const cliContextOut = JSON.parse(runCopiedPowerShellCommand(copiedCliCommands[0]));
    assert.equal(cliContextOut.status, 'ok');
    assert.equal(cliContextOut.method, 'get_context');

    const cliTimeSummaryOut = JSON.parse(runCopiedPowerShellCommand(copiedCliCommands[2]));
    assert.equal(cliTimeSummaryOut.status, 'ok');
    assert.equal(cliTimeSummaryOut.method, 'get_time_summary');

    const cliIdeaAddOut = JSON.parse(runCopiedPowerShellCommand(copiedCliCommands[1]));
    assert.equal(cliIdeaAddOut.status, 'ok');
    assert.equal(cliIdeaAddOut.method, 'save_idea');
    assert.equal(cliIdeaAddOut.result.status, 'committed');

    const cliTimerStartOut = JSON.parse(runCopiedPowerShellCommand(copiedCliCommands[3]));
    assert.equal(cliTimerStartOut.status, 'ok');
    assert.equal(cliTimerStartOut.method, 'start_timer');
    assert.equal(cliTimerStartOut.result.status, 'committed');

    const cliTimerStopOut = JSON.parse(runCopiedPowerShellCommand(copiedCliCommands[4]));
    assert.equal(cliTimerStopOut.status, 'ok');
    assert.equal(cliTimerStopOut.method, 'stop_timer');
    assert.equal(cliTimerStopOut.result.status, 'committed');

    const cliHelpOut = runCopiedPowerShellCommand(copiedCliCommands[5]);
    assert.ok(cliHelpOut.includes('monorail context') && cliHelpOut.includes('monorail timer start'));

    // Verify on-disk persistence in isolatedDataDir
    const recordFiles = (await readdir(join(isolatedDataDir, 'records'))).filter(f => f.endsWith('.md'));
    const receiptFiles = (await readdir(join(isolatedDataDir, 'receipts'))).filter(f => f.endsWith('.json'));
    const timelogFiles = (await readdir(join(isolatedDataDir, 'timelog'))).filter(f => f.endsWith('.md'));
    assert.equal(recordFiles.length, 2, 'Both MCP and CLI idea records must be persisted on disk');
    assert.equal(receiptFiles.length, 4, 'All 4 committed write receipts (MCP idea, CLI idea, CLI timer start, CLI timer stop) must be persisted');
    assert.ok(timelogFiles.length >= 1, 'Timelog markdown file must be persisted on disk');

    const settingsYamlAfter = await readFile(join(isolatedDataDir, 'settings.yaml'), 'utf8');
    assert.ok(settingsYamlAfter.includes('autostart: false'), 'Isolated settings.yaml must retain autostart: false');

    await cp(join(isolatedConfigDir, 'mcp-host.json'), join(evidenceDir, 'sample-mcp-host.json'), { force: true });

    const verificationSummary = {
      version: '0.3.0-beta.2',
      customInstallDir,
      isolatedDataDir,
      isolatedExePath,
      isolatedMcpPath,
      isolatedCliPath,
      copiedMcpConfig: parsedMcpConfig,
      copiedHttpCommand,
      copiedCliCommands,
      clipboardVerification: {
        source: 'Windows Get-Clipboard -Raw (unpatched navigator.clipboard.writeText with CDP userGesture)',
        verifiedButtonsCount: 8,
      },
      mcpVerification: {
        getContextOperationId: mcpContextResult.operation_id,
        savedIdeaId: mcpSaveIdeaResult.data.id,
        savedIdeaText: mcpSaveIdeaResult.data.text,
        findIdeasCount: mcpFindResult.ideas.length,
      },
      cliVerification: {
        contextStatus: cliContextOut.status,
        timeSummaryStatus: cliTimeSummaryOut.status,
        ideaAddOperationId: cliIdeaAddOut.operation_id,
        ideaAddText: cliIdeaAddOut.result.data.text,
        timerStartActivity: cliTimerStartOut.result.data.timer.open_entry.description,
        timerStopActivity: cliTimerStopOut.result.data.timer.open_entry.description,
        helpContainsSubcommands: true,
      },
      diskPersistence: {
        recordFiles,
        receiptFiles,
        timelogFiles,
      },
      missingPathVerification: {
        errorAlertDisplayed: true,
        allEightCopyButtonsDisabled: true,
      },
      screenshots: [
        'ui-01-automation-overview.png',
        'ui-02-automation-mcp-config.png',
        'ui-03-automation-cli-examples.png',
        'ui-04-automation-troubleshooting.png',
        'ui-05-automation-missing-path-error.png',
        'ui-06-about-section-10.png',
      ],
    };
    await writeFile(
      join(evidenceDir, 'verification-result.json'),
      JSON.stringify(verificationSummary, null, 2) + '\n',
      'utf8',
    );
  } finally {
    try {
      ws.close();
    } catch {}
  }
} finally {
  killIsolatedApp();
  removeTestRunRegistryEntryIfAny(beforeSnapshot.runEntries);
  // Clean up isolated installation, config, and WebView2 profile so no test artifacts pollute the user's system
  await sleep(500);
  await rm(customInstallDir, { recursive: true, force: true });
  await rm(isolatedConfigDir, { recursive: true, force: true });
  await rm(isolatedWebViewDir, { recursive: true, force: true });
  await rm(workDir, { recursive: true, force: true });
  // Remove the temporary NSIS installer copy after verification so we don't leave huge binaries untracked
  await rm(join(evidenceDir, `${ISOLATED_PRODUCT_NAME}_0.3.0-beta.2_x64-setup.exe`), { force: true });

  const afterSnapshot = getRunRegistryAndDailySnapshot();
  await writeFile(join(evidenceDir, 'run-registry-after.json'), JSON.stringify(afterSnapshot, null, 2) + '\n', 'utf8');

  assert.deepEqual(
    afterSnapshot.runEntries,
    beforeSnapshot.runEntries,
    'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run must be identical before and after test',
  );
  assert.deepEqual(
    afterSnapshot.dailyApp,
    beforeSnapshot.dailyApp,
    'Daily installed app state must remain completely untouched',
  );
}

console.log('Beta.2 Automation Guide isolated E2E verification succeeded!');

# 0.3.3 隔离原生实测与真实多窗口矩阵证据（`evidence/0.3.3-isolated/`）

## 1. 隔离环境信息与保护基线（4 项前后端点比对）

本次实测采用 `--debug --no-bundle --config` 构建隔离版可执行文件，使用独立 `identifier`、独立 AppData 配置目录、独立 WebView2 用户数据目录、独立 Named Pipe 与独立临时数据目录，不触碰用户正在运行的日常安装版单轨（`PID=2320`）。

| 维度 | 0.3.3 隔离实测环境值 | 0.3.2 隔离对照环境值 | 日常正式版对照（未触碰） |
| --- | --- | --- | --- |
| `identifier` | `local.pixelrecord.v033test.t98dfce7e8ed8` | `local.pixelrecord.v032test.t9050f8e9d817` | `local.pixelrecord.app` |
| `productName` | `单轨0.3.3隔离测试` | `单轨0.3.2隔离测试` | `单轨` |
| 隔离可执行文件 (`exe`) | `C:\Users\kai_wei\AppData\Local\Temp\monorail-v033-98dfce7e8ed8\Monorail-0.3.3-isolated.exe` | `C:\Users\kai_wei\AppData\Local\Temp\monorail-v032-9050f8e9d817\Monorail-0.3.2-isolated.exe` | `C:\Users\kai_wei\AppData\Local\单轨\pixel-record.exe` |
| 隔离配置目录 (`profile`) | `C:\Users\kai_wei\AppData\Roaming\local.pixelrecord.v033test.t98dfce7e8ed8` | `C:\Users\kai_wei\AppData\Roaming\local.pixelrecord.v032test.t9050f8e9d817` | `C:\Users\kai_wei\AppData\Roaming\local.pixelrecord.app` |
| 隔离数据目录 (`data`) | `C:\Users\kai_wei\AppData\Local\Temp\monorail-v033-98dfce7e8ed8\data` | `C:\Users\kai_wei\AppData\Local\Temp\monorail-v032-9050f8e9d817\data` | 日常数据目录（由日常 `config.json` 指向） |
| 隔离 WebView2 目录 (`webview`) | `C:\Users\kai_wei\AppData\Local\local.pixelrecord.v033test.t98dfce7e8ed8` | `C:\Users\kai_wei\AppData\Local\local.pixelrecord.v032test.t9050f8e9d817` | `C:\Users\kai_wei\AppData\Local\local.pixelrecord.app` |
| 隔离 Named Pipe (`pipe`) | `\\.\pipe\local.pixelrecord.v033test.t98dfce7e8ed8.mcp` | `\\.\pipe\local.pixelrecord.v032test.t9050f8e9d817.mcp` | `\\.\pipe\local.pixelrecord.app.mcp` |

### 实测前后保护基线比对（`baseline-before.json` vs `baseline-after-p7.json` / `baseline-after-supplement.json`）

> **基线范围说明**：此基线为实测开始前与结束后的 **4 项端点状态比对**（非全程连续采样监控，亦未对日常数据目录做全量文件哈希扫描）：
- **`runSame: true`**：`HKCU:\Software\Microsoft\Windows\CurrentVersion\Run` 前后一致（`"单轨": "C:\Users\kai_wei\AppData\Local\单轨\pixel-record.exe "` 未改动）。
- **`dailyExeSame: true`**：日常版 `pixel-record.exe` SHA256 保持 `807f074d4d5fd8e62d92ccf141f5d7f1fb6e924035a383ed37f444e0c573cbea` 不变。
- **`dailyConfigSame: true`**：日常版 `config.json` SHA256 保持 `4a004ccdb7bb6ebb76c88d13acf268ee0d89a2a822751982521554cd07eb4b05` 不变。
- **`dailyProcessUntouched: true`**：日常版进程 `PID=2320` 在主跑与补证跑前后保持同一进程实例运行。

---

## 2. 构建产物与源码指纹绑定（`buildAndArtifactBindings`）

构建命令：
```bash
node evidence/0.3.3-isolated/setup.mjs --build
```

| 产物 / 源码文件 | SHA256 | 大小 / 时间戳 (`lastWriteTimeUtc`) |
| --- | --- | --- |
| `Monorail-0.3.3-isolated.exe` | `e8da6eb9543b67637157bc0acd34c0c81585981076b00cf5f78c54a3a59acc57` | `33,371,136 bytes` (`2026-11-08T14:07:01.156Z`) |
| `monorail-cli.mjs` (0.3.3) | `276356edaaf7f15b67dfe907b2935ab4667d3ddbb15cd04431c24d0a8a086f45` | `1,005,832 bytes` (`2026-11-08T14:06:21.249Z`) |
| `monorail-mcp.mjs` (0.3.3) | `068d79e8333ff778d73ea2e312df7278ed918015d21dfaf535cee6e15c95ace7` | `1,620,290 bytes` (`2026-11-08T14:06:20.351Z`) |
| `Monorail-0.3.2-isolated.exe` | `cde06a7a9fdaabf168331c2ef3287e2b319b44bc5b6f0f418c58bb7172279cfb` | `32,669,696 bytes` (`2026-11-07T14:26:02.930Z`) |
| `src/services/ideaService.ts` | `b095c3597b897518d76ea3156a937161377ccc55623f6ac43f54741cd015918e` | 当前工作树源码 |
| `src/services/updateService.ts` | `37c614e82fafcb37d585fc1e5f8ccaf6fe53542c4d4a4d1ede1f4410b622be12` | 当前工作树源码 |
| `src/platform/ideaWindows.ts` | `c83da12f9f78d20a7ca78a7c22d09211e0820643f054e4d03e7689ba74a62346` | 当前工作树源码（单一 Rust DTO 校验 + `createDraftCheckTracker` + Owned Ticket 取消与异常传播） |
| `src/app/IdeaWindowApp.tsx` | `8202970b6bd47c8e28246a030be8a23a9666ac8022fea5bdf5bc46880775d274` | 当前工作树源码 |
| `src/app/QuickBarApp.tsx` | `eb3f61fee4a1d12d871a1f5d9c04df944c9d351c3402ca1b4cf76f501cb96d8c` | 当前工作树源码 |
| `src/app/MainApp.tsx` | `c856d3bc18ee664ddbfaba895cbdf066ed582919dbe90faea6f84e489bd8c6dd` | 当前工作树源码 |
| `src/app/SettingsScreen.tsx` | `d95ac7aad9cb7d4391920df9be2479eae2aed2d771e1b34d902fafc363af9c5a` | 当前工作树源码 |
| `src/app/BagScreen.tsx` | `dcfffdbe356006a3af273ddd1c0c57d5e0defbfde8cf2dd18e024d1c06ef237a` | 当前工作树源码 |
| `src/pages/home/drawer/BagDrawer.tsx` | `257f9d01ead077c4879573142348d3c472ec4ff13dadb08c1e27f8825d122cbc` | 当前工作树源码 |
| `src/pages/home/drawer/IdeaPool.tsx` | `37ce431fd2c07f0bcf935ede29b55885713883f455ff578e3a896409d3460299` | 当前工作树源码 |
| `src-tauri/src/idea_windows.rs` | `1fb80617b523bec90cc829bf9c33307ed9b311a54eafe737d50a6e57826f155f` | 当前工作树源码 |
| `src-tauri/src/quick_save.rs` | `911863e076144a126ac6206bb029f244ddd523b60e2b5b759b1992c4518c34a5` | 当前工作树源码 |
| `src-tauri/src/updates.rs` | `e1a8af20896b98c9aee38b3aed63f10086c4516fd35a36024b4d097d683065bb` | 当前工作树源码 |
| `src-tauri/src/update_state.rs` | `068b3ec8224e2b4469dcb5eaa88dfc71d8bbd5c80a658f54c3a87a218781284c` | 当前工作树源码 |
| `src-tauri/src/tray.rs` | `90bd4f86316a3cc0262c14f4d7c5ec8ae88d88dba10fe115b00462f8cd0d265a` | 当前工作树源码 |
| `src/data/migrations/v3.ts` | `f151b64693e0077dca764530624a6d65c98d278b26dd5071c9114ef116cb2a45` | 当前工作树源码 |

---

## 3. 第一轮：真机 WebView2 7 项多窗口矩阵实测（`results-p7.json`：`allPassed: true`，原样保留）

执行命令：
```bash
node evidence/0.3.3-isolated/run-p7-native.mjs
```

| 矩阵项 | 实测内容与关键断言 | 状态 | 证据截图 |
| --- | --- | --- | --- |
| **0. 多主线任务并存 (`multiMainTasks`)** | 通过隔离 CLI 连续创建两条 `slot="主线"` 的任务（`主线任务 Alpha`、`主线任务 Beta`），验证多主线不降级、不互斥并存并在背包任务区同时展示。 | **PASS** | `shots/01-main-multi-main-tasks.png` |
| **1. 打开 / 同 ID 聚焦 / 异 ID 多窗并存 (`openFocusCoexist`)** | 1) 打开 `ideaA` 独立窗口（`action: "opened"`），验证阅读态 GFM 标题/表格/代码块渲染及 `javascript:` 危险协议拦截（`hasJavascriptHref: false`，安全 `https://` 链接带 `↗` 标识）；<br>2) 再次打开同 ID `ideaA` 返回 `action: "focused"` 且 `countLabelA === 1`（不重复建窗）；<br>3) 打开异 ID `ideaB` 返回 `action: "opened"`，与 `ideaA`、`main`、`quickbar` 四窗并存。 | **PASS** | `shots/02-ideaA-read-markdown.png`<br>`shots/03-ideaB-coexisting-window.png` |
| **2. 脏关闭三选弹窗 (`dirtyCloseThreeChoices`)** | 在 `ideaB` 独立窗进入编辑态修改 Markdown 正文后点击窗内关闭按钮，弹出三选对话框：<br>1) 点击「继续编辑」→ 留在编辑态且未保存草稿完整保留；<br>2) 点击「保存并关闭」→ 窗口关闭且修改落盘至 `records/<id>.md`；<br>3) 重新打开 `ideaB` 修改后点击「放弃修改并关闭」→ 窗口关闭且磁盘内容保持不变。 | **PASS** | `shots/04-dirty-close-dialog-3choices.png` |
| **3. 保存同步与过期修订冲突 (`saveSyncAndConflict`)** | 1) `ideaA` 窗口处于干净编辑态时，外部 CLI 更新 `ideaA` 正文 → 窗口自动同步最新修订且不误报冲突横幅（`cleanSyncHasConflictBanner: false`）；<br>2) `ideaA` 窗口有本地未保存修改时，外部 CLI 再次更新 `ideaA` → 弹出冲突横幅但**绝不覆盖**本地脏草稿；<br>3) 点击「以我的草稿继续（基于最新修订）」并保存 → 成功基于最新修订写入；<br>4) 再次制造外部新版本并点击「加载外部最新版」→ 编辑器切换为外部最新内容。 | **PASS** | `shots/05-ideaA-revision-conflict-banner.png` |
| **4. QuickBar 草稿交接、双端保存、显式清空项目关联与附件 (`quickbarHandoffAndAttachments`)** | 1) 在 QuickBar 输入标题 `#交接`、展开详情输入 Markdown、选择所属项目「主线任务 Alpha」、拖入 PNG 附件后点击「去独立窗口编辑」打开 `idea-draft-*`；<br>2) 先在独立草稿窗点击「保存想法」落盘（验证生成唯一记录 `handoff1CountBeforeQbSave === 1`，含 `task_id` 与落盘附件 `attachmentDiskExists: true`）；<br>3) 随后在 QuickBar 将所属项目切换为「不属于项目」（显式 `taskId: null`）并再次保存 → 复用同一记录（`handoff1CountAfterQbSave === 1`，不产生重复记录）且磁盘 `records/<id>.md` 的 `task_id` 被显式清除（`taskAssociationClearedToNull: true`）。 | **PASS** | `shots/06-quickbar-before-handoff.png`<br>`shots/07-idea-draft-window-opened.png` |
| **5. 主窗口隐藏到托盘后台保存 + 重载过期 `mainEpoch` 拒绝 (`hiddenMainSaveAndStaleEpochReject`)** | 1) 将 `main` 窗口 `hide()` 隐藏到后台（`mainVisibleWhileHidden: false`），在 `ideaA` 独立窗编辑并保存 → 主窗口后台完成单写者落盘（`hiddenSavePersistedOnDisk: true`）；<br>2) 保持 `ideaA`（`mainEpoch=1`）打开，令主窗口执行 `location.reload()` 升级至 `mainEpoch=2`；<br>3) 在旧 `ideaA` 窗口尝试保存 → 被 `EPOCH_MISMATCH` 明确拦截，磁盘未被覆盖（`staleEpochDidNotOverwriteDisk: true`），本地草稿与原 `operationId` 保留。 | **PASS** | `shots/08-ideaA-saved-while-main-hidden.png`<br>`shots/09-ideaA-stale-epoch-rejected.png` |
| **6. 仅修改正文 Dirty 检测与维护/退出取消恢复 (`detailsOnlyDirtyAndExitCancelRestore`)** | 在 `mainEpoch=2` 下重新打开 `ideaA` 窗口，**保持标题不变、仅修改 Markdown 正文**：<br>1) 触发跨窗维护草稿检查 `check_drafts_for_maintenance` → 准确识别仅正文修改的脏窗口并拦截（返回 `想法笔记窗口还有未保存内容，请先保存或放弃修改后重试维护操作`），同时锁定独立窗口输入控件（`titleDisabled: true, detailsDisabled: true`）；<br>2) 调用 `cancel_maintenance_check` → 独立窗口立即解除锁定（`titleDisabled: false, detailsDisabled: false`），未保存正文草稿毫发无损，随后点击「保存修改」正常落盘。 | **PASS** | `shots/10-ideaA-details-only-dirty-maintenance-locked.png`<br>`shots/11-ideaA-maintenance-cancel-restored-and-saved.png` |

---

## 4. 第二轮：针对 `@coder` 与 `@coder-6` R4 的真机定点补证（`results-p7-supplement.json`：`allPassed: true`）

执行命令：
```bash
node evidence/0.3.3-isolated/run-p7-supplement.mjs
```

| 补证项 | 实测路径与关键断言 | 状态 | 证据截图 |
| --- | --- | --- | --- |
| **补证 1：OS 级窗口关闭 (`WM_CLOSE` → `CloseRequested`) 脏三选弹窗 + 零工程黑话 UI 文案 + 严格关窗断言 (`osCloseDirtyThreeChoicesAndCleanCopy`)** | 1) **UI 文案校验**：验证独立窗口顶栏显示 `阅读视图 · 点击链接在浏览器中打开`，底栏显示 `快捷键：Ctrl+Enter 保存 · Esc 关闭` 与 `已与主窗口同步`，页面全文零 `Single Writer` / `baseRevision` / `sessionEpoch` / `REV ir3:...`（`hasSingleWriterJargon: false, hasRevJargon: false`）；<br>2) **真实 OS 级 `WM_CLOSE` 拦截**：通过 Win32 `PostMessageW(hWnd, 0x0010 /* WM_CLOSE */, 0, 0)` 向 `单轨 · 想法笔记` 窗口句柄发送系统关闭消息，触发 Rust `WindowEvent::CloseRequested` → `api.prevent_close()` → `idea-window-close-requested` 事件，弹出三选对话框；<br>3) **三分支严格关窗校验**：分别验证「继续编辑」（草稿保留）、再次发送 `WM_CLOSE` 点「保存并关闭」以及重开修改后发送 `WM_CLOSE` 点「放弃修改并关闭」；每次关窗均通过 `assertWindowClosedWithMainAlive` 严格断言（CDP HTTP 正常响应、`main` 窗口存活且可求值、目标 `idea-*` 标签从 target 列表消失，`remainingLabels: ["quickbar", "main"]`）。 | **PASS** | `shots/12-clean-ui-copy-no-jargon.png`<br>`shots/13-os-close-dirty-dialog.png` |
| **补证 2：真实退出处理链（`app-exit-requested` → 拦截 → 保存 → `performAppExit` 进程退出）(`realExitBlockedThenSaveThenCleanExit`)** | > **触发机制说明**：通过 `plugin:event\|emit_to('main', 'app-exit-requested')` 触发 `MainApp` 注册的生产级退出监听链（`offExit` → `checkDraftsForMaintenance` → `performAppExit`），而非物理鼠标点击系统托盘菜单。<br>1) 独立窗口保持标题不变、仅修改 Markdown 正文；<br>2) 触发 `app-exit-requested` → 主窗口弹出错误提示 `想法笔记窗口还有未保存内容，请先保存或放弃修改后重试维护操作`，进程保持存活（`processAliveAfterBlockedExit: true`），且在拦截分支 `finally` 中自动调用 `cancelMaintenanceCheck()` 恢复独立窗口可编辑状态（`titleDisabled: false, detailsDisabled: false`）与未保存草稿；<br>3) 在独立窗口点击「保存修改」落盘后，再次触发 `app-exit-requested` → 通过 `checkDraftsForMaintenance` 并执行 `performAppExit`，`Monorail-0.3.3-isolated.exe` 进程干净退出（`cleanExitOutcome: { code: 0, signal: null }`）。 | **PASS** | `shots/14-real-exit-blocked-toast-on-main.png` |
| **补证 3：0.3.3 真实 v2→v3 迁移 + 旧版 `Monorail-0.3.2-isolated.exe` 打开干净 v3 报错零篡改 + 恢复 `backup/v2-*` 正常打开 (`old032ExeRejectsV3AndRestoresV2Backup`)** | > **场景范围说明**：本项覆盖的是 **0.3.3 完成迁移并干净退出后（`activeJournalFiles === 0`）的干净 v3 数据目录被旧版 0.3.2 打开** 的场景（不包含未完成 `.journal` 事务下跨版本混开的极端场景）。<br>1) 构造真实 Schema v2 数据目录（`state.yaml` / `settings.yaml` 为 `schemaVersion: 2, mainTasks: 1`，含多行 v2 想法 `records/11111111-2222-4333-8444-555555555555.md` 与 `timelog/2026-10-01.md`）；<br>2) 启动 `Monorail-0.3.3-isolated.exe` 完成原生 v2→v3 迁移（`schemaVersion: 3`、`mainTasks: 2`、多行想法拆分为首行标题与详情正文，生成 `backup/v2-*`）；停止 0.3.3 写者后将完整 v3 目录复制到 `0.3.2` 授权范围内的独立 `v3-drill` 目录；<br>3) 启动真实旧版 `Monorail-0.3.2-isolated.exe` 打开 `v3-drill` → 界面显示 `打不开这个数据目录：state.yaml: invalid state`，且打开前后 `v3-drill` 目录内全部文件（`state.yaml`、`settings.yaml`、`records/*.md`、`timelog/*.md`、`plans/*.yaml`、`backup/v2-*`）SHA256 100% 一致（`v3HashesUnchangedAfter032Reject: true`）；<br>4) 将 `backup/v2-*` 复制恢复至独立目录 `v2-restored-drill`，再次启动 `Monorail-0.3.2-isolated.exe` → 正常进入主页并在「背包 → 想法池」完整显示原 v2 多行想法（`restoredBodyShowsV2Idea: true`）。 | **PASS** | `shots/15-old-032-exe-rejects-v3-data.png`<br>`shots/16-old-032-exe-opens-restored-v2-backup.png` |

---

## 5. 真机实测与审查闭环中捕获并修复的问题清单

1. **`@coder-6` R3 发现的 `C1`（`W3`/`W4` 显式 `task_id: null` 清除关联，已在 R4 关闭）**：
   - **原因**：`src/services/ideaService.ts` 的 `normalizeUpdateIdeaOperationInput` 此前将 `input.task_id ? ... : undefined` 归一化为省略字段，导致独立窗口 / QuickBar / MCP 传入 `task_id: null` 时无法清除已有项目关联。
   - **修复**：在 `CanonicalUpdateIdeaOperationInput` 与 `normalizeUpdateIdeaOperationInput` 中保留显式 `null`（`input.task_id !== undefined ? { task_id: input.task_id?.trim() || null } : {}`），`evidence/0.3.3-coder6-window-interop-review.test.ts` 的 `W1`–`W4`（4/4）与真机矩阵 4 全部通过。
2. **真机 WebView2 捕获问题 #1 + `@coder-6` R4 `N1`（Rust/TS DTO 严格单一形状校验与交接保存会话校验）**：
   - **原因**：Rust `open_idea_window` / `idea_window_hello` / `idea-window-draft-handoff` 与前端 `src/platform/ideaWindows.ts` 字段命名初期不一致；且 R3 过渡修补曾引入多候选字段宽松兜底。
   - **修复**：在 `src/platform/ideaWindows.ts` 移除所有多形状猜测与静默默认值，改为严格校验 Rust 真实单一 DTO 契约（`RustOpenIdeaWindowResult`、`RustIdeaWindowRegistration`、`RustIdeaDraftHandoffEvent`），缺失或非法字段立即抛错；在 `src/app/QuickBarApp.tsx` 保存 `handoffSessionRef`，并在 `src-tauri/src/idea_windows.rs` 的 `verify_sender` 支持按 `draft_id` / `record_id` / `window_session` 匹配交接会话。
3. **真机 WebView2 捕获问题 #2（Tauri v2 多窗口 `idea-window-reply` / `idea-window-close-requested` 跨窗事件串扰）**：
   - **原因**：Tauri v2 中全局 `listen('idea-window-reply')` 会收到发往其他想法窗口的 `loaded` 回执；当窗口 A 与窗口 B 同时打开时，窗口 B 的 `loaded` 回执会触发窗口 A 的监听器。
   - **修复**：在 `src-tauri/src/idea_windows.rs` 为 `idea-window-reply` 与 `idea-window-close-requested` 注入 `targetLabel`，在 `src/platform/ideaWindows.ts` 按当前窗口 `label` 过滤，并在 `src/app/IdeaWindowApp.tsx` 按 `loadReqIdRef` 与 `boundRecordIdRef` / `draftMetaRef` 双重校验，同时在 `src/app/ideaWindowApp.test.ts` 补齐跨窗回执隔离回归单测。
4. **真机 WebView2 捕获问题 #3（QuickBar 携带附件交接时 `save_attachment` 需 `withQuickSave` 登记）**：
   - **原因**：Rust `save_attachment` 强制检查 `quick_save::ensure_active`，而 `QuickBarApp.tsx` 的 `handleOpenIdeaWindow` 与 `handleSave` 在交接分支写附件时未包裹 `withQuickSave`。
   - **修复**：在 `src/app/QuickBarApp.tsx` 的交接附件落盘逻辑外包裹 `withQuickSave(snapshot.draftId / attachOwnerId, ...)`，真机矩阵 4 拖拽 PNG 附件交接落盘验证通过。
5. **`@coder` 视觉走查反馈（独立窗口顶栏/底栏工程黑话清理）**：
   - **原因**：`src/app/IdeaWindowApp.tsx` 顶栏/底栏曾暴露 `阅读态（安全外链 ↗）`、`编辑态（主窗口 Single Writer）`、`REV ir3:...`、`待交由主窗口新建落盘` 等内部实现术语。
   - **修复**：全部替换为面向普通用户的中文提示（`阅读视图 · 点击链接在浏览器中打开`、`编辑中 · 按 Ctrl+Enter 保存`、`快捷键：Ctrl+Enter 保存 · Esc 关闭`、`已与主窗口同步` / `尚未保存`），并在补证 1（`shots/12-clean-ui-copy-no-jargon.png`）完成真机验收。
6. **`@coder` & `@coder-6` R5–R7 审查发现的 `M1`（维护草稿检查协议、正安全整数 `generation` 排序、Owned Ticket 取消与异常传播）**：
   - **原因**：此前 `update-check-draft` / `draft-check-restore` 未带 `targetLabel`、`requestId` 与单调 `generation`，3 窗口全局监听产生 9 次 ACK 并在首轮完成后使后续 `cancelMaintenanceCheck` 弹出额外报错 Toast（`没有等待中的更新草稿检查`，R5 历史归档已保留于 `results-p7-supplement-r5-historical.json`）。
   - **修复**：Rust `Gate` 与 `DraftCheckEventPayload` 注入 `targetLabel`、`requestId` 与正安全整数 `generation`；`record_ack` 从 `window.label()` 取真实 caller、强校验 `request_id` 与 `expected` 且同轮重复 ACK 幂等不覆盖首条 `dirty`；`cancel_check` 与 `perform_app_exit` 强校验所属 `requestId`；前端 `createDraftCheckTracker` 强校验 `generation` 单调序与先到 `restore` 永久关轮，`runAppExitWithMaintenanceCheck`、`runDirectoryChangeWithMaintenanceCheck` 与 `installUpdate` 仅取消各自持有的 ticket 且在取消或关窗失败时显式传播错误；真机补证 2 重跑验证主窗仅弹出脏窗口阻塞提示且 `hasSpuriousNoPendingError: false`。

---

## 6. 未验证项与范围边界说明（诚实声明）

- **安装包级（NSIS / MSI）覆盖升级与降级回滚实测未在本轮执行**：根据 `@coder` 的隔离实测方案，本轮采用 `--debug --no-bundle --config` 方式运行，以杜绝 NSIS 安装器触碰日常安装目录 `C:\Users\kai_wei\AppData\Local\单轨\` 或覆盖注册表项。
- **Win32 `WM_CLOSE` 首次窗口枚举说明**：在补证 1 中，`wmClose1` 按隔离进程 PID 枚举到该进程下 3 个带非空标题的顶层可见 HWND（`单轨 · 想法笔记`、`单轨`、`local.pixelrecord.v033test.t98dfce7e8ed8-siw`）；主窗口 `main` 收到 `WM_CLOSE` 后按设计隐藏到托盘并保持存活（随后的 `wmClose2`、`wmClose3` 仅命中 `单轨 · 想法笔记` 1 个可见 HWND），每次关窗后 `assertWindowClosedWithMainAlive` 均证实 `main` 窗口存活且可求值。
- **每一步写入边界的进程级崩溃中断矩阵未在原生 EXE 层逐点穷举**：Schema v2 → v3 迁移在真实临时文件系统上的幂等重跑、坏输入失败回滚、备份恢复与版本高于应用拦截由 `evidence/0.3.3-p6-verification.test.ts` 覆盖；逐写入边界的崩溃恢复逻辑由 `src/data/migrations/v3.test.ts` 单元测试覆盖。

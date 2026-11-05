# 0.3.0-beta.4 隔离真窗口实测（D1 小窗选分类与历史记录、D2 想法完成）

2026-11-05 · 证据类型：**真窗口**（隔离身份的 debug exe，WebView2 调试端口驱动真窗口，真实鼠标事件经 CDP 送进 WebView2）。

## 环境与隔离

| 项 | 值 |
|---|---|
| 代码 | F1–F6 提交 `4f2e4db` 之后，加上实测中修的「隐藏时离开编辑」（本目录同一提交） |
| 隔离身份 | `local.pixelrecord.beta4test.t<12 位随机>`，productName `单轨Beta4隔离验收`；临时数据 `%TEMP%\monorail-b4-<随机>\data`；只给这个目录 fs 权限 |
| 构建 | `npm run build` 后 `tauri build --debug --no-bundle --config <隔离配置>`（`setup.mjs --build`），复制为 `Monorail-beta4-isolated.exe`；没有打包、没有安装 |
| 首次启动前 | 数据目录预置 v1 `settings.yaml`（关开机自启、隔离快捷键）；配置目录预置 `config.json`、`mini-window.json`（小窗放在屏幕靠上） |
| 用户项目 | 第一次启动迁移完成后停掉，`settings.yaml` 补「学习」「工作」两个项目再启动（新目录里只有系统项目） |
| CLI | 本仓库 `dist-cli/monorail-cli.mjs`，经 `MONORAIL_PIPE` / `MONORAIL_CONFIG_DIR` / `MONORAIL_EXECUTABLE` 指向隔离管道。调用方「Claude Code」是用 `CLAUDECODE=1` 模拟的，不是真客户端 |
| 屏幕 | 工作区 0–1392（逻辑像素），缩放 1 |
| 日常版 | 全程运行（PID 39192），只读不写。前后 Run 启动项、日常 exe 与 `config.json` 的 SHA-256、PID 都相同（`baseline-before.json`、`baseline-after.json`、`cleanup.json`） |
| 收尾 | 每轮结束停掉隔离进程，删掉该轮隔离身份的配置目录、WebView2 目录和临时目录（`cleanup-run1..3.json`、`cleanup.json`，全部 `gone: true`） |

## 结果（第 4 轮，`run4.log`、`results.json`、截图 `shots/`）

| 步骤 | 操作与断言 | 结果 |
|---|---|---|
| boot | 启动、迁移、补项目、再启动，进首页；Run 项没有新增 | 通过（`01`） |
| ideas（D2） | CLI 存两条想法 → 背包 · 想法池点〔✓ 完成〕→ 提示「已完成「…」」、这一行离开想法池、文件是 `pool: 冷库` + `completed_at` + `completed_by: manual` → 切到「已完成」，有「完成于 今天」「手动」→〔撤销完成〕回到活跃池（`completed_at: null`）→ CLI `idea done <B>`（`CLAUDECODE=1`）→ 列表显示「CLI · Claude Code」→ 再标一次 `noop: true` → `find --include-archived` 状态「已完成」→ 不存在的 ID 退出码 3 `IDEA_NOT_FOUND` | 通过。历史：`idea.complete`（手动，活跃池→已完成）、`idea.uncomplete`（已完成→活跃池）、`auto.complete_idea`（CLI · Claude Code，活跃池→已完成）（`02`–`05`） |
| miniSmall（D1） | 待机打开小窗口，点名字 → 自动完成往下展开，窗口 88 → 224，本体在屏幕上不动 → 点「记到」→ 分类下拉 → 选「学习」→ 写「隔离验收：读书」回车 → 新条目记到「学习」，窗口回到 88；计时中点名字（改名）不出自动完成 | 通过。历史 `mini.editOpen`（小窗），新条目项目「学习」（`06`–`08`） |
| miniUp（D1 自适应） | 暂停；把小窗移到贴屏幕底边（y 1301）；点名字 → 弹层翻到上面：窗口上移到 1135、高 254，本体仍在 1301；写「读」筛出「隔离验收：读书」，点它 → 「继续」这一条（照抄分类「学习」），窗口回到 y 1301、高 88 | 通过。历史 `mini.pause`、`mini.continueEntry`（小窗）（`09`、`10`） |
| miniTiny（D1） | 设置 → 窗口与数据 → 小窗口样式选「mini窗口」→ 没有「×」、读数 16px、名称右边分类块「学习」→ 点分类块选「工作」→ 正在计的这一条改到「工作」→ 暂停后点名字出自动完成（贴底边，往上） | 通过。历史 `mini.editOpen`（项目 学习→工作）（`11`–`13`） |
| miniHideExpanded（D1） | 自动完成开着时用底栏「关闭小窗口」关掉，再打开：编辑已离开、弹层收起，窗口回到本体高度和位置；`mini-window.json` 记的是本体（320×46），不是展开后的高度 | 通过 |
| finish | 停进程，比对基线 | Run 项、日常 exe、日常 `config.json`、日常 PID 都没变；历史 11 条 |

## 实测中发现并修好的问题

- **小窗被关掉时还在写名字**（第 1 轮）：隐藏的窗口里编辑和弹层还开着，Rust 隐藏前把窗口收回本体高度，再打开时弹层被截在本体里。修法：`mini-visibility` 事件也发给小窗自己，小窗收到「隐藏」就和点别处一样离开输入框（有字写盘，没字接着计待确认）、收起弹层（`MiniApp.tsx`、`mini_visibility.rs`）。第 4 轮 `miniHideExpanded` 通过。
- 第 1–3 轮其余失败是脚本问题：刚显示的窗口没等系统焦点就点、新目录里没有「学习」项目、断言把新条目找错了位置（从待确认开始时，历史的主体是被截断的待机，新条目在连带里）。`probe-mini.mjs`、`probe-focus.mjs` 是排查焦点时用的探针：小窗有焦点时点名字，输入框保持聚焦、窗口变高不会让它失焦。

## 没测

- 弹层展开时用鼠标拖动小窗（Rust 按上移量换算回本体位置的那段）：只有单测覆盖放置计算，拖动本身未测。
- 多显示器、缩放不是 100% 的屏幕：未测（放置计算单测里有负坐标副屏的例子）。
- 输入法组合输入、键盘方向键（自动完成照主窗口只能鼠标点）：未测。
- 真实 AI 客户端（`complete_idea` 只用 CLI 模拟调用方测过；MCP 工具只在 MCP 冒烟里列出，没在真窗口调用）。
- 打包安装版、Windows 冒烟（`../架构设计.md` §8）：未测，见 `../0.3.0-beta.4-summary.md`。

## 复现

```powershell
npm run build
node evidence/beta4-isolated/setup.mjs --build
node evidence/beta4-isolated/run.mjs            # 可只给步骤名：boot ideas miniSmall miniUp miniTiny miniHideExpanded finish
node evidence/beta4-isolated/cleanup.mjs
```

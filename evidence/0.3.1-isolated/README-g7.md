# 0.3.1 隔离真窗口测试（第二批：G7 界面）

2026-11-06 · 证据类型：**真窗口**（新的隔离身份 `local.pixelrecord.v031test.t<12 位随机>` 的 debug exe，WebView2 调试端口驱动；真实鼠标事件经 CDP 送进 WebView2）。第一批的隔离身份已删掉（`cleanup-run1.json`，三个目录 `gone: true`）。环境、隔离方法同 [README.md](README.md)。

## 结果（`results-g7.json`、截图 `shots-g7/`）

| 步骤 | 操作与断言 | 结果 |
|---|---|---|
| boot | 启动、迁移，补两个项目和一个快捷活动「上厕所」；顶栏没有「背包」 | 通过（`01`） |
| drawer | 底栏〔背包〕拉开抽屉 → 新建主线任务，两项：「第 3 章」切成时间盒（分钟数默认 60，取设置 01）、「写读书笔记」结果卡 → 卡上〔排进今天〕浮层（时间盒默认剩下的时长 1:00）→ 板子上一行「0:00 / 1:00」→ 详情里第二项也排进今天 → Esc 收起；`plans/` 文件两项 | 通过（`02`–`06`） |
| flip | 〔抽一张〕：卡飞出、洗牌、翻开（截图）；翻开的卡上没有概率；〔开始〕开始抽到的那张，抽屉收起 | 通过（`07`–`09`） |
| insert | 做卡中从快捷活动弹层插入「上厕所」：插入卡盖在上面；鼠标放回去区域左边（〔回到任务〕）、右边（红色烟雾「结束原任务」）各截一张；底栏〔↩ 第 3 章 等你回来〕；〔暂停〕→「已暂停 · 还在等你回去 00:00」→〔继续〕→「插入中」→ 点〔回到任务〕插入卡收走；历史 `home.startPreset`、`home.pause`、`home.continueInsert`、`home.resume` | 通过（`10`–`14`） |
| shrink | 〔缩小〕对话框（条子、滑块、今天 / 剩下两块）写「3.1–3.3」→ 详情里两项都带 SHRINK，剩下的那份 25 分钟 | 通过（`15`、`16`） |
| readoutAfterSplit | 缩小以后回到首页，大读数不超过累计 | 通过（第 4 轮：`03:13 \| 累计 0:03`，`18`） |
| taskModeOff | 设置 02 关掉任务模式 → 抽屉只剩想法池（没有板子、没有任务卡）、提示「任务模式关着」；CLI `get_context.today_plan` 为 null；`timer start-item` 报 `TASK_MODE_OFF`；再打开 | 通过（第 4 轮，`17`） |
| finish | Run 项、日常 exe、日常 `config.json`、日常 PID 都没变 | 通过 |

## 实测中发现并修好的问题

- **关掉任务模式后抽屉还是旧的**（第 1–3 轮）：`BagScreen` 从 `ctx.settings` 读开关，设置改了以后这一层不会重新渲染。改成从 store 读（提交 `dff393d`）。第 4 轮通过。
- **缩小以后大读数显示 24:30、累计 0:00**（第 1 轮截图 `09` 之后）：数据核对过，时间记录是对的（`timelog/2026-11-06.md`）。最可能是冷启动入场动画的读数乱码层在窗口隐藏 / 后台时没清掉（`requestAnimationFrame` 停了）。给乱码层加了定时器兜底（`ui/effects/reveal.ts`）。修好以后第 4 轮没有再出现；**原因没有直接证实**，记作「没再复现」。
- 第 1 轮 `flip` 失败是脚本问题（等待条件返回了元素而不是布尔值）；后面几步跟着失败是因为没有开始卡。

## 没测

- 跨换日时改大读数（G7 审核 B1 的拒绝提示）：只有单测。
- 带过来的确认条逐项去勾：要过换日才出现，**未测**（有渲染单测）。
- 动效「简化」「关闭」下的插入卡和翻卡：**未测**。
- 960×600 窗口下抽屉和插入卡：**未测**。
- 小窗的插入状态：**未测**（只有无头截图）。
- 键盘 Tab 走一遍：**未测**。

## 复现

```powershell
npm run build
node evidence/0.3.1-isolated/setup.mjs --build
node evidence/0.3.1-isolated/run-g7.mjs     # boot drawer flip insert shrink readoutAfterSplit taskModeOff finish；接着上一轮的数据跑加 reopen
node evidence/0.3.1-isolated/cleanup.mjs
```

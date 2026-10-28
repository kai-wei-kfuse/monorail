# 0.2.1 收尾

补丁版，不改数据格式（schemaVersion 仍是 2），不需要迁移演练和回退说明。

## 内容

| 提交 | 内容 |
|---|---|
| 308fa22 | 版本号改为 0.2.1 |
| 9b4f446 | 小窗去掉常驻操作说明，只在有提示（出错、主窗口未响应、改读数结果）时显示那一条 |
| 374c6fc | 首页：正在计时时「＋」换成停止（■），停止转为待机、不留〔继续〕，计卡时卡被 align 放回；不在计时显示「＋」 |
| 49c0ff1 | 发版说明 `docs/releases/0.2.1.md` |

## 检查与构建

- `npm run version:check`：通过，见 `version-check.log`。
- `npm run check`：tsc、eslint、vitest 59 个文件 390 项全部通过（新增 `homeService.test.ts`「stop ends the open entry…」），见 `check.log`。
- `npm run tauri -- build --debug --no-bundle`：成功，产物 `src-tauri/target/debug/pixel-record.exe`，见 `build-debug.log`。

## UI 对照（gallery 预览，无头 Chrome，脚本 `ui/shots.mjs`）

`?page=live` 接真 service、内存数据；`?page=mini` 是真 MiniApp 接假主窗口。结果见 `ui/shots.log` 和截图。

| 场景 | 结果 |
|---|---|
| 小窗计时中 | `.mini-cap` 0 个，下面没有说明那一条（`mini-running.png`） |
| 融合布局 待机 | 〔开始〕＋ 「＋」 |
| 融合布局 计时中 | 〔暂停〕＋ 停止 |
| 融合布局 按停止后 | 回到待机，〔开始〕＋ 「＋」，没有〔继续〕；条目表里写周报截断、新开一条待机 |
| 融合布局 暂停后 | 〔继续〕＋ 「＋」 |
| 分开布局 计时条 | 同上四种，结果一致 |

计卡时停止只有单测覆盖，没有截图。

## Windows 冒烟（架构设计 §8）

| 条目 | 结果 |
|---|---|
| 6 主窗口和小窗同时开着 / 小窗高度 | 未测（真窗口里小窗没有说明时高度是否收回 88px，需要在真程序里看） |
| 首页停止按钮在真程序里 | 未测 |
| 9 应用内更新 0.2.0 → 0.2.1 | 未测，发版后在本机设置 → 关于 → 检查更新时补 |
| 其余条目 | 本版没有改到，未测 |

## 没做的事

- 原型 `原型/页面/home.js`、`stage.js` 的「＋」没有同步改成停止；`UI风格规范.md` 已改。
- 小窗里没有加停止按钮。

# 0.2.2 收尾

补丁版，不改变数据格式。首页和小窗的读数支持透明、无框的原地编辑，光标落在末尾。

## 检查与构建

- `npm run version:check`：通过，见 `version-check.log`。
- `npm run check`：通过，59 个测试文件、390 项测试，见 `check.log`。
- `npm run tauri -- build --debug --no-bundle`：通过，见 `build-debug.log`。
- 使用独立应用标识的 Windows 调试构建：见 `build-smoke.log` 和 `smoke-tauri.conf.json`。

## UI 检查

- Chromium 预览使用内存数据。`ui/results.json` 和 `ui/*-editing.png`、`ui/*-expanded.png` 是修复黑框前的记录。
- 用户实测指出大窗读数有黑框；修复前的 `ui/card-editing.png` 也能看到它。
- `ui/focus-check.mjs` 在输入框处于 `:focus-visible` 状态时检查大卡、计时条和小窗：无外轮廓、无边框、透明、有下划线，且光标位于末尾。运行前启动 `npm run dev -- --port 5301 --strictPort`，再运行 `node evidence/release-0.2.2/ui/focus-check.mjs http://127.0.0.1:5301`；结果见 `ui/focus-check.log` 和 `ui/*-focus-fixed.png`。

## Windows 冒烟

| 项目 | 结果 |
|---|---|
| 小窗读数编辑 | 修复前用户反馈正常；修复后的隔离 Windows 构建复验通过，见 `ui/native-mini-focus.png` |
| 大窗读数编辑 | 修复前用户发现黑框；修复后的隔离 Windows 构建复验通过，见 `ui/native-main-focus.png` |
| 0.2.1 应用内更新到 0.2.2 | 未测，须在发布后验证 |
| 架构设计 §8 其他条目 | 本版未改到，未测 |

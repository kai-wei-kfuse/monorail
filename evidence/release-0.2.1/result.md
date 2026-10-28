# 0.2.1 发布结果

- tag `v0.2.1` → `017cbe30a56b24ac2dd3a48aced5bffb1575d56e`（master 最新提交，release.yml 与默认分支一致）。
- CI：run 40698914870，tag push 触发，2026-10-28T13:42:31Z → 13:48:30Z，约 6 分钟，全部步骤成功。rust-cache 命中，Build signed NSIS 3 分 34 秒（0.2.0 那次无缓存，15 分 26 秒）。
- Release「单轨 v0.2.1」：不是草稿，不是预发布。资产：
  - `monorail_0.2.1_windows-x86_64_setup.exe`（8927162 字节，asset 685141566）
  - `monorail_0.2.1_windows-x86_64_setup.exe.sig`（436 字节）
  - `latest.json`（1383 字节）
- `latest.json`（副本在 `published/`）：version 0.2.1；platforms 只有 windows-x86_64；url 指向安装包 asset 685141566；signature 与发布的 `.sig` 内容一致；notes 是 `docs/releases/0.2.1.md`。

## 未测

- 本机设置 → 关于 → 检查更新，从 0.2.0 更新到 0.2.1（冒烟第 9 条）：未测，需要在真程序里操作。
- 真程序里小窗高度、首页停止按钮：未测，见 `summary.md`。

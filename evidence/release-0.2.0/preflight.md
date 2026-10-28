# 0.2.0 发布前核对

2026-10-28（北京时间）。用户已明确授权推送 master 和 v0.2.0、等待 CI 发布。

- 起点：master `d308438`，包含 N7；fetch 后相对 origin/master 为落后 0、领先 37 个提交。
- 修改范围：两份 0.2.0 发布/回退说明和本目录的发版证据；没有修改应用代码。
- 对照 `src/data/migrations/v2.ts`、`v2.test.ts`、`src/app/bootstrap.ts` 及 v0.1.4 的 settings schema，修正备份目录命名、排除项、迁移版本判定和记录位置。回切 v2 时保留回退后产生的 v1 数据。另修正待确认起点“不写盘”的错误说明。
- `npm run version:check`：0.2.0，一致，退出码 0，见 `version-check.log`。
- `npm run check`：TypeScript、ESLint 通过；59 个测试文件、389 项测试通过，退出码 0，见 `check.log`。测试运行器已有整个进程 60 秒上限。
- `git diff --check`：通过。
- 发布前远程 `v0.2.0` tag 和 Release 均不存在；既有版本不覆盖、不删除。
- `evidence/journal-real.json` 是他人改动，不纳入暂存或提交。检查前 SHA256：`E8EB510C29A000835D415A51E25D248C0F2A02BF8C1A882B7FAE934FDE7BC590`。本次遗漏了现有 `src/data/journal.test.ts:54` 的副作用：运行 check 时该测试覆盖了这个文件，检查后 SHA256 为 `4BCC8C1BA4704E3753C81DAF9FBF4A7B7C1C27B0B120AAC631FAC96044317485`。未事先备份原始内容，无法可靠恢复；没有用 HEAD 内容覆盖它，已向用户说明。

## 本机情况与未验证项

- 卸载注册信息显示正式应用仍是 0.1.3，安装在 `C:\Users\kai_wei\AppData\Local\单轨`；没有安装或运行新版本。
- 交接文档 19:54 的更新与只读检查一致：`F:\单轨` 当前为空；旧数据位于 `F:\单轨-旧-20261028`，其中仍有 `backup/v1-2026-10-28T09-47-10-871Z-4bcc1a32-cc8d-47aa-afdd-916f3edc568c`。
- 因此“当前 F:\单轨 已是 v2，0.1.3 无法启动”的旧提醒不再适用于当前空目录。若改指向归档里的 v2 数据，旧版仍会拒绝读取。
- 冒烟第 9 条可从历史 v1 备份副本测试，也可在当前空目录中先由 0.1.3 创建测试记录后升级。不能用旧版直接打开归档中的 v2 数据。
- `evidence/n7-summary.md` 的 12 条 Windows 冒烟、真实窗口读数确认提示、实际安装旧版的回退演练仍未测；本次发布检查不替代这些手工验收。

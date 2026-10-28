# 0.2.0 CI 测试环境修复

2026-10-28（北京时间）。

- 首次运行：`40684439310`，源码 `fa591f75ddefe1ca60d3c9a91dc5e094050ecf82`。387 项通过、2 项失败，停在测试；构建和发布未执行。完整失败步骤日志见 `ci-attempt-1-failure.log`。
- 根因：`src/data/migrations/v2.test.ts` 的夹具时间是 2026-10-28 UTC 零点附近，却固定读取 `timelog/2026-10-28.md`。`activityDay` 按本地时间和 4 点日界计算，在 UTC 下目标文件是 2026-10-27，在 Asia/Shanghai 下是 2026-10-28。生产行为符合本地活动日语义；CI 没有声明夹具所需时区。
- 复现：仅运行 `node node_modules/vitest/vitest.mjs run src/data/migrations/v2.test.ts`，分别传入 `TZ=UTC` 和 `TZ=Asia/Shanghai`。UTC 稳定重现同两处空文件读取错误；上海时区 6 项全部通过。见 `migration-utc.log`、`migration-shanghai.log`。两次进程均执行项目规定的 60 秒上限，没有运行会覆盖 journal-real.json 的测试。
- 修复：只给 `.github/workflows/release.yml` 的 `npm test` 步骤设置 `TZ=Asia/Shanghai`，注明原因及影响范围；同步 `docs/updates.md`。不修改应用日期算法，不跳过测试，不改变构建进程时区。
- 恢复方式：推送 master 的工作流修复后，使用 `workflow_dispatch --ref master -f tag=v0.2.0`。保留原 tag；checkout、构建和签名使用原标签的源码。工作流提交与构建源码提交需在发布结果中分别记录。

## 第二次运行：发布 API 权限

- `40685262899`：工作流提交 `d972014c4976c88fab6d02c3b78d96b2c64ce579`，checkout 日志确认源码为原 tag 的 `fa591f75ddefe1ca60d3c9a91dc5e094050ecf82`。全部 389 项测试、TypeScript、ESLint 和签名 NSIS 构建通过。
- 发布失败：`gh release create --draft` 返回 `403 Resource not accessible by integration`；Release 查询为 404，未创建草稿。日志见 `ci-attempt-2-failure.log`。
- 实际 token 权限在 Set up job 日志中为 `Contents: write`、`Metadata: read`。目标 tag 与默认分支的 `.github/workflows/release.yml` 存在测试时区差异。GitHub 官方 Create a release 文档明确记录：目标与默认分支间存在 workflow 文件差异时要求 workflow 修改授权，部分认证方式返回此 403；`GITHUB_TOKEN` 无法取得该权限。来源：`https://docs.github.com/en/rest/releases/releases#create-a-release`（抓取原文摘录另存 `github-release-api-excerpt.md`）。
- 恢复：为工作流增加签名产物 artifact 和显式 `publish` 输入（默认 true）。本次以 `publish=false` 完整运行检查和签名构建，下载产物后，用本机已有 repo/workflow scope 的 gh 登录运行原发布脚本。没有上传本机凭据到 Actions，没有覆盖 tag/Release，也没有把发布错误隐藏成成功。

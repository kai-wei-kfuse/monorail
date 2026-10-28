# 0.2.0 CI 测试环境修复

2026-10-28（北京时间）。

- 首次运行：`40684439310`，源码 `fa591f75ddefe1ca60d3c9a91dc5e094050ecf82`。387 项通过、2 项失败，停在测试；构建和发布未执行。完整失败步骤日志见 `ci-attempt-1-failure.log`。
- 根因：`src/data/migrations/v2.test.ts` 的夹具时间是 2026-10-28 UTC 零点附近，却固定读取 `timelog/2026-10-28.md`。`activityDay` 按本地时间和 4 点日界计算，在 UTC 下目标文件是 2026-10-27，在 Asia/Shanghai 下是 2026-10-28。生产行为符合本地活动日语义；CI 没有声明夹具所需时区。
- 复现：仅运行 `node node_modules/vitest/vitest.mjs run src/data/migrations/v2.test.ts`，分别传入 `TZ=UTC` 和 `TZ=Asia/Shanghai`。UTC 稳定重现同两处空文件读取错误；上海时区 6 项全部通过。见 `migration-utc.log`、`migration-shanghai.log`。两次进程均执行项目规定的 60 秒上限，没有运行会覆盖 journal-real.json 的测试。
- 修复：只给 `.github/workflows/release.yml` 的 `npm test` 步骤设置 `TZ=Asia/Shanghai`，注明原因及影响范围；同步 `docs/updates.md`。不修改应用日期算法，不跳过测试，不改变构建进程时区。
- 恢复方式：推送 master 的工作流修复后，使用 `workflow_dispatch --ref master -f tag=v0.2.0`。保留原 tag；checkout、构建和签名使用原标签的源码。工作流提交与构建源码提交需在发布结果中分别记录。

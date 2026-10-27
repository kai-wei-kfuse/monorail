# ADR 0003：保留唯一的测试进程期限

- 状态：Accepted
- 日期：2026-10-27

项目已有 test-runner.mjs 负责整个测试进程的 60 秒硬期限，其注释明确约束整个进程而不是单个用例。Vitest 默认另加 5 秒单项期限，形成两套不同的判定。

真实验收中，原有 20 次开始/完成压力用例两次分别在约 5.39 秒和 5.19 秒被默认单项期限打断；当时全套测试总耗时只有约 8 秒，其他 219 项通过。同一文件在单独进程运行时 8 项断言全部通过，约 2.83 秒完成，说明并发负载会使单项墙钟期限产生误报。

在 Vitest 配置中将 testTimeout 设为 0，移除重复的单项期限。继续通过 npm test/test-runner.mjs 执行，保留原有 60 秒进程硬上限及失败日志；不跳过断言、不增加任意超时或改变业务行为。

证据：evidence/private-updater/check-tls-fix.txt、check-tls-isolated.txt、stress-with-process-deadline.txt。后续全套与 CI 检查继续验证该统一期限。

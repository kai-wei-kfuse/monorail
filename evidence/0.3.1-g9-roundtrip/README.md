# 0.3.1 源码数据往返

2026-11-06，NodeFs 调各版本真实数据仓库和服务，**不是旧版 EXE**。旧版 EXE 的有限往返另见 `../release-0.3.1/native-roundtrip.*`。

顺序：1-produce031（63f7f2c）→复制数据→2-consume030（v0.3.0/23d6240）→复制数据→3-verify031-after030；从第1步数据另复制→4-consume025（v0.2.5/3f5ac0a）→复制数据→5-verify031-after025。前四步由 coder-3 执行，复制命令没有单独留档；第5步 coder 接手后执行，21个检查全部通过。

脚本参数见 `scripts/step.ps1`。依赖对应临时 worktree（`$env:TEMP/monorail-rt-031` / `-030` / `-025`）及各自 node_modules；输入输出数据在 `$env:TEMP/monorail-rt-data/`，不可指向日常目录。各目录是独立副本，切换版本前复制，不能同时在同一数据目录运行。

```powershell
# 每一步的 Tree 是 031、030 或 025；Test 为 scripts 下对应文件名。
# 必须先复制前一步数据到新目录；step.ps1 不替调用者复制。
.\scripts\step.ps1 -Step 1-produce031 -Tree 031 -Test produce031.test.ts -Data a-031
# a-031 → b-030，再执行 consume030；b-030 → c-031back，再执行 verify031。
# a-031 → d-025，再执行 consume025；d-025 → e-031after025，再执行 verify031。
.\scripts\step.ps1 -Step 5-verify031-after025 -Tree 031 -Test verify031.test.ts -Data e-031after025 -Base '<绝对路径>/results/1-produce031.json,<绝对路径>/results/4-consume025.json'
```

原结果和日志保留在 results、logs；新跑时用新的 Step 名称和独立数据副本，不覆盖旧证据。`step.ps1` 现已传播 Vitest 失败，不再只记录 exit 后返回成功。

覆盖：plans 字节、split_note、旧版改卡/改设置/补记、四个新设置非默认值、原始计时条目、暂停插入、状态引用、journal清理、新版重新写入与重启。新版本逻辑采用运行日2026-11-06的夹具；其他日期重跑需要显式调整夹具时钟，不改系统时钟。

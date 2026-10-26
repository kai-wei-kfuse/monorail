# M0 基础整顿验证

2026-10-27。依据首期开发计划 M0 的七项要求。

1. 仓库与 transact：data/repos.ts 唯一创建仓库/Journal，bootstrap 注入；commit.ts 对 data 只使用接口类型，Write 为不透明类型。
2. 日期读取：bootstrap 启动恢复后 scan 一次并校验 max_seq、有效时间线和唯一当前段；补齐旧 state 的 open_segment_day。普通动作仅 readDays(当前段日期、今日)，IO 计数测试确认不列举 timelog、不读其他历史。
3. InTx：switchInTx 仅接 tx，不捕获根 ctx；run(tx,...) 在 await 前后均直接抛重入错误。正常根动作仍串行排队，已有20组 start/complete 并发用例继续通过。
4. 数据测试：frontmatter 的 BOM/CRLF、正文分隔符、未知嵌套字段、坏 YAML 路径报错；schemas 的类型/时间/序号校验；mdRepo 的未知字段保留、读写路径报错及同内容 mtime 冲突。
5. settingsRepo：settings.yaml 读写含 lists；只有缺文件使用全新默认配置，坏文件显式失败；用户当前配置注入 ctx，待机名称由设置读取。
6. CLAUDE.md：42 行，含分层、单向 service 图、显式事务作用域、Write 不透明、术语和测试命令。
7. 包名：npm/Cargo/Tauri productName 改为 pixel-record，Rust库同步；保留应用 identifier 防止已有数据目录/授权发生迁移。

## 运行证据

- `m0-check.txt`：tsc、eslint、Vitest 通过，12 个测试文件/59 项测试（包含并行团队提交的 UI 测试）。测试进程硬上限仍为 60 秒。
- `m0-build.txt`：普通非 verify Windows debug 构建成功，产物 `src-tauri/target/debug/pixel-record.exe`。保留原有第三方 PURE 注释及 bundle 大小警告。
- `m0-native-events.json`：真实启动连接原数据目录，journal-recovered:0、reconcile:0、cards=1，当前计时段和 started_at 保持原值。
- `m0-native-stderr.txt`：本次启动无原生错误。进程 37244 的真实路径为上述 pixel-record.exe。
- 原数据 state.yaml 已从旧格式补齐 `open_segment_day: 2026-10-26`；settings.yaml 保存三项数值和空快捷活动/休息池、待机名称。

## 边界

重入检测使用团队明确同意的事务作用域合同：根 ctx 代表独立用户动作，tx 代表当前事务。禁止 InTx 闭包捕获根 ctx 再启动用户动作；未使用会误拒绝合法并发的全局 busy 标记。

本轮未重复十分钟后台、真实休眠、自启重启等原生测试；M0 没有修改其业务能力，遗留项按首期计划留到后续里程碑。不含并行 UI/页面实现，也未把历史 evidence/journal-real.json 的工作区变动提交进 M0。

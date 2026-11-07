# 0.3.2 正式发布完成

2026-11-07（北京时间）。用户在隔离桌面双窗口确认GUI，并明确指示“让coder发版吧”。coder已完成提交、标签推送、签名CI、公开发布和发布后复验。

- Release：https://github.com/kai-wei-kfuse/monorail/releases/tag/v0.3.2
- 源码：8c60915ecae689ac9b2a123d81c94c58c3d21821；annotated tag v0.3.2 对象05da8dfa4ee8194e1ad185ab846ea58ff94789aa。master先推、标签后推，工作流与默认分支一致。
- CI：https://github.com/kai-wei-kfuse/monorail/actions/runs/42384154392 ，全部success；生产配置签名NSIS。
- Release ID：437649353；非草稿、非预发布，GitHub stable latest为v0.3.2。
- 安装器：monorail_0.3.2_windows-x86_64_setup.exe，9,432,282字节；SHA-256：8e82137b1263cbe4ed58ce81397c213cdbaea2a7433e814fcc5d212bcd536971。

## 发布前与CI检查

版本四处同步0.3.2。TypeScript、MCP TypeScript、ESLint通过；99文件/760应用测试、12 MCP、8 CLI、10发布工具测试通过，构建自包含MCP/CLI通过。CI重新运行760应用测试并完成正式签名构建。45 Rust、27定向复核、真实gallery与P7隔离原生双窗口证据见 ../0.3.2-summary.md。

npm run check最初因本机缺node_modules/.bin命令入口，在tsc执行前明确失败；用final-check.mjs按完全相同顺序运行各工具实际JS入口，未减少检查。发现complete.test.ts未使用变量后以clone+delete修正夹具，重新全量通过。完整日志final-check.log；CI原始日志ci.log留本机。

## 公开资产与签名复验

verify-publication.mjs 42384154392 实际通过，结果verification.json：

- tag解析源码与CI headSha一致，来源release.yml/push/v0.3.2，release job及签名步骤成功。
- Release精确包含exe、exe.sig、latest.json；所有公开资产大小与GitHub digest一致。
- exe与sig同CI signed-nsis artifact哈希一致。
- latest.json版本、平台asset API URL、签名、stable/schema2兼容元数据及notes均一致，Release正文等于标签内发行说明。
- 使用标签生产公钥验证安装包签名与trusted comment成功；内存篡改一字节后验证失败。
- 未执行安装器，未更新日常安装。

## 更新渠道复验

verify-channel-selection.mjs从v0.3.2取原样生产Rust选择/兼容函数，用GitHub真实分页Release列表和公开manifest运行通过：stable、beta、return-to-stable均选择v0.3.2；schema2兼容来源manifest；从0.2.5、0.3.0、0.3.1与0.3.0-beta.3升级的相应判断通过，0.3.2不重复提供自己。channel-selection.log与channel-check-run.log留证。这不是在日常应用内安装或重启的记录。

## 留存与边界

- 实现提交：feat(0.3.2): complete task lifecycle and 0.3.x automation；后续文档提交记录发布验证结果，标签保持不变。
- 用户日常exe/config/进程及数据未被发布操作修改；隔离测试实例已关闭。下载公开安装包与CI产物仅用于读/验签，不执行。
- 两处接手前已有改动evidence/journal-real.json、evidence/0.3.1-isolated/env.json未提交未回退；隔离env、个人注册表原始基线、历史遗留材料未提交。
- 旧版独立EXE往返仍未测，兼容结论限源码对齐与内存IO验证；其余未测边界以实现汇总为准。发布不将这些未测项改成通过。
- 使用新版MCP/CLI前重启AI客户端；Node.js要求24+。

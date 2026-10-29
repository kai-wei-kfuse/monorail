# 0.2.2 发布结果

- 正式 Release：<https://github.com/kai-wei-kfuse/monorail/releases/tag/v0.2.2>，不是草稿或预发布，也是当前 latest。
- 原标签 `v0.2.2` 指向 `db8ef179f13d5630cf2204dbd3365011f1a20d77`。验证提交为 `f9b7e278393f71d3064c455bfbac17f9e6131a02`；签名构建已切回原标签，过程与 CI 工作树说明见 `recovery.md`。
- 恢复构建 run `40863594897` 成功；安装包 SHA-256 为 `6deaa56634453d52f147c30a84420ee3a2e9d60e6c33896d1eb91c50d0f99b37`。
- Release 包含安装包、签名文件和 `latest.json`。下载后的三个文件与 GitHub 记录的大小和 SHA-256 一致；安装包也与 CI 资产一致。明细见 `verification.json`。
- 使用应用内公钥验证安装包和签名通过，修改安装包一个字节后验证失败，见 `signature-verification.log`。
- `latest.json` 的版本、说明、安装包 API 地址和签名均已核对。清单与签名副本位于 `published/`。
- 本机应用内更新未由本次操作执行；用户表示会自行更新。

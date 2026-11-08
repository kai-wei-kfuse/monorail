# 0.3.3 正式发布记录

2026-11-09（Asia/Shanghai）· 执行方 coder · 用户已明确授权发布。

## 发布结果

- Release：https://github.com/kai-wei-kfuse/monorail/releases/tag/v0.3.3
- 源码提交：`d1f4e76dc7d3be74cee2a8f53dfe3504754df7ff`，annotated tag `v0.3.3`，master先推后推tag。
- 签名CI：`42501830508`，全部success；Release ID `438386250`，公开、非draft、非prerelease、stable latest。
- 安装包：`monorail_0.3.3_windows-x86_64_setup.exe`，9,624,287字节。
- SHA256：`71e7de352fac625a373f4c0fbc9f93735dd69f275abc5e75069f96bd89fc77b0`。

## 发布后复验

主代理实际执行 [verify-publication.mjs](verify-publication.mjs)：3资产名称/大小/GitHub digest正确；公开exe/sig与CI artifact哈希相同；notes与tag内容/Release body一致；清单版本/下载地址/签名/schema3与readable[2,3]正确；生产公钥验签成功，篡改一个字节被拒绝。[结果](verification.json)。

实际执行 [v0.3.3选择器](verify-channel-selection.mjs) 和 [原样v0.3.2选择器](verify-old032-selection.mjs)，使用真实分页Release列表及公开latest.json：stable/beta/return均选v0.3.3；旧0.3.2接受schema3清单中的readable[2,3]并可识别升级，新版不重复提供自身。不执行安装器，也不把函数级渠道验证写成实际安装升级。

## 发布前验证与范围

`npm run check`：104文件780项、MCP12/12、CLI8/8；Rust65/65；版本一致。发版工具schema旧断言更新后10/10。最终原生验证和coder-6 R9审核沿既有记录。旧journal-real/031env未纳入提交，原始隔离env/Run基线未提交。

日常安装未更新、未运行安装器。NSIS/MSI覆盖升级/回滚、物理托盘点击和原生逐中断穷举仍为未测；已发布签名安装包不代表这些路径已在本机执行。

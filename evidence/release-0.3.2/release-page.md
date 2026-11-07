---
title: 单轨 0.3.2 已正式发布
subtitle: 签名CI与发布后复验全部通过
theme: blueprint
mode: light
lang: zh
cols: 2
---

## A 下载与更新
```callout ok 正式稳定版已公开
安装包、签名和更新清单已核对一致。
生产公钥验签通过，篡改安装包会被拒绝。
稳定版与Beta渠道均可选择0.3.2。
```

[打开GitHub Release](https://github.com/kai-wei-kfuse/monorail/releases/tag/v0.3.2)

[下载Windows安装包](https://github.com/kai-wei-kfuse/monorail/releases/download/v0.3.2/monorail_0.3.2_windows-x86_64_setup.exe)

也可在单轨设置的关于页检查更新。
使用新版MCP或CLI前，请重启AI客户端。

## B 本版变化与验证
| 变化 | 内容 |
|---|---|
| 任务与子任务 | 单项完成和取消、整张完成和重新打开 |
| 插入事件 | 自由计时、小窗和mini窗口提供显式入口 |
| 开始计时 | 背包开始时复用旧擦除动画 |
| 底栏 | 四个按钮按6px间距紧凑排列 |
| 自动化 | MCP与CLI共36个方法 |

760条应用、12条MCP、8条CLI与10条发布工具测试通过。
隔离原生双窗口验证与签名CI通过。
公开资产哈希、签名和更新渠道复验通过。
日常安装未被发布操作修改，尚未替用户安装更新。

[CI记录](https://github.com/kai-wei-kfuse/monorail/actions/runs/42384154392) · [完整发布证据](<file:///C:/Users/kai_wei/Documents/1026(4)/app/evidence/release-0.3.2/summary.md>)

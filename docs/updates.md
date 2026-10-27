# 私有开发版更新与发版

## 使用

仓库与 Release 均保持 private：https://github.com/kai-wei-kfuse/monorail 。首次手动安装带更新功能的版本；当前旧版没有检查更新功能。

每台电脑需安装 GitHub CLI，在终端运行 `gh auth login --hostname github.com`，登录有仓库读取权限的账号。应用只在原生进程中临时读取该登录，凭据不传入前端、不放入安装包或配置。未登录、网络错误、缺失清单、签名错误各自显示失败，不能把失败显示为「已是最新版本」。

在「设置 → 关于」点击「检查更新」，查看版本与说明，再选择「下载更新」。只有官方 updater 下载并验证签名成功后才显示「重启并安装」。Windows 使用 passive NSIS 安装，显示进度，覆盖现有同产品安装，再启动应用。

界面直接订阅原生状态，显示检查中、下载中、验证中、安装准备中和安装中，并标明当前子步骤、已经过的秒数和失败位置。展开「查看更新步骤」可查看完整时间线。重新连接或重新打开页面不会重置后台任务；重复检查只读回已有任务。通信错误通过「重新连接状态」读回，不假定更新已结束。协议与回归依据见 ADR 0002。

安装前主窗口队列停止接收新写入并等待已接纳事务完成；后台电源/日界事件等候安装失败后解除封口。快速记录采用覆盖附件、记录和 data-changed 的完整保存会话。原生端在禁止新会话后隐藏记录条，再通过 WebView 往返读取真实草稿。有未保存输入或正在保存时拒绝安装并保留输入，处理后可重试。签名或安装失败时写入会恢复；任务本身不被结束。重启间隔沿用现有离线规则。

## 版本来源

`package.json.version` 是发布输入；`tauri.conf.json.version` 指向 `../package.json`。Cargo 及两个锁文件由脚本同步，关于页使用 Tauri 的实际应用版本。

```powershell
npm run version:set -- 0.1.3
npm run version:check
```

将该版本修改说明写入 `docs/releases/0.1.3.md`，检查并提交代码，推送 `v0.1.3` tag。版本号仅为示例，不重复使用已经发布的 tag。

## 自动发版

`.github/workflows/release.yml` 在 `v*` tag 推送时使用 Windows runner 执行检查、构建并发布。仓库 Secrets 中的 `TAURI_SIGNING_PRIVATE_KEY` 和 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` 用于签名；公钥已在 Tauri 配置中。私钥和密码保存在仓库外，不能提交或作为 Release 资产上传。

发布脚本先创建 draft 并上传 exe 与 sig，然后根据实际资产 ID 生成 latest.json，最后公开该 Release 给仓库授权用户。清单的签名字段是 sig 文件内容，下载 URL 为需要认证的 GitHub asset API。应用拒绝把凭据发送到其他仓库或主机；HTTPS 跨主机重定向由 reqwest 移除敏感请求头。相同 tag 的 Release 不覆盖，失败草稿需检查具体错误后处理。

本机手动签名构建使用当前 PowerShell 进程环境变量，密钥内容和密码不得写在命令历史里：

```powershell
$env:VITE_VERIFY = 'false'
$env:TAURI_SIGNING_PRIVATE_KEY = '<仓库外私钥文件的绝对路径>'
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = '<从安全存储读取到当前进程>'
npm run tauri -- build
```

发布已有产物时：

```powershell
npm run release:publish -- --tag v0.1.3 --notes docs/releases/0.1.3.md --installer 'src-tauri/target/release/bundle/nsis/单轨_0.1.3_x64-setup.exe'
```

## 真实原地更新验收

使用 `src-tauri/tauri.update-test.conf.json` 构建独立产品「单轨更新验收」，identifier 为 `local.pixelrecord.update-test`。该配置指向私有 prerelease `update-test-v0.1.2`；正式应用读取最新正式 Release。两者公钥相同，原生下载、验签、安装与前端业务代码相同，测试构建不启用 verify feature。

安装 0.1.1 到独立验收路径，并选择独立测试数据目录，保留用户正在运行的旧版。发布已签名的 0.1.2 验收资产后，在已安装的 0.1.1 界面点击检查、下载和安装。记录安装路径、exe 版本、安装前后数据快照与持久化目录授权，确认真实覆盖。验收版本不会成为正式 latest。

结果和日志：`evidence/private-updater/`；最终结论写入 `修改日志.md`。旧产品名「像素记录」迁移到「单轨」的安装记录兼容性不属于此次同产品升级结论。

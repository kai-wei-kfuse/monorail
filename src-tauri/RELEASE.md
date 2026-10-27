# 像素记录 0.1.0 Windows 发布

## 打包配置

- 产品名：像素记录；版本：0.1.0；应用标识：`local.pixelrecord.app`。
- 目标：Windows x64 NSIS 安装包；按当前用户安装；安装器语言为简体中文、英文。
- 图标：从 `src/ui/marks/Emblem.tsx` 的 ▽ 徽记几何生成，配色取现有 tokens。源文件 `icons/app.svg`；应用、安装器及托盘共用生成的 PNG/ICO。
- 图标重建：在 app 根目录执行 `npm exec tauri -- icon src-tauri/icons/app.svg --output src-tauri/icons`。只需提交 app.svg、icon.png、icon.ico，其他平台图标由既有 .gitignore 忽略。
- 托盘菜单：显示主窗口、快速记录、退出。显示主窗口会先恢复最小化；快捷活动菜单不显示可能过期的默认快捷键。

## 从旧版本升级

旧标识为 `local.taskterminal.skeleton`。新标识改变了 `app_config_dir` 和保存目录访问授权的 `app_data_dir`。本次没有自动迁移旧配置：只复制 config.json 无法同时恢复 persisted-scope 的独立目录授权。

首次打开新版时，请重新选择原来的数据文件夹。records、cards、projects、reviews、timelog 和 settings.yaml 都仍在原数据目录，不会因标识改变而移动或删除。不需要新建空数据目录，也不要把旧 app_config_dir 当作数据目录。

## 生产构建

在 app 根目录执行 `npm run tauri build`，使用默认 `tauri.conf.json`、默认生产 Vite 构建，不传 `--features verify` 或 `tauri.verify.conf.json`。构建时 `VITE_VERIFY=false`，避免进程环境意外启用验证入口。Cargo 的 verify 特性没有默认启用；验证命令和单实例触发分支均受 Rust cfg 保护。

NSIS 产物位于 `src-tauri/target/release/bundle/nsis/`，交付副本放在 `app/发布/`，文件名带版本号。构建日志和交付核验结果另见本目录的 release-build.log、release-audit.json；代码检查日志见 release-check.log。

本轮仅验证编译打包、产物存在/大小/哈希以及验证入口未进入生产构建，不运行应用 exe，也不安装或运行安装包；真机安装由用户完成。安装器沿用 Tauri 默认的 WebView2 引导配置，缺少运行时的机器可能需要联网获取它。

## 发布前修复

经 lead 授权，回顾投影 `bet` 增加 `projectId`，ReviewPage 用 ID 定位旧主线；页面类型复用 store 合同。两个项目同名时不会再把另一个项目传给换主线对话框。补充页面组件与服务连续复盘两项回归，源代码不会因为这项修复引入新的 UI 流程。

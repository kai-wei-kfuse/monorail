# 单轨（MONORAIL）0.1.0 Windows 发布

## 打包配置

- 产品名：单轨；英文名：MONORAIL；版本：0.1.0；应用标识：`local.pixelrecord.app`。
- 目标：Windows x64 NSIS 安装包；按当前用户安装；安装器语言为简体中文、英文。
- 图标：从 `src/ui/marks/Emblem.tsx` 的 ▽ 徽记几何生成，配色取现有 tokens。源文件 `icons/app.svg`；应用、安装器及托盘共用生成的 PNG/ICO。
- 图标重建：在 app 根目录执行 `npm exec tauri -- icon src-tauri/icons/app.svg --output src-tauri/icons`。只需提交 app.svg、icon.png、icon.ico，其他平台图标由既有 .gitignore 忽略。
- 托盘菜单：显示主窗口、快速记录、退出。显示主窗口会先恢复最小化；快捷活动菜单不显示可能过期的默认快捷键。

## 本次名称变更（2026-10-27）

「像素记录 / PIXEL RECORD」改为「单轨 / MONORAIL」。内部 npm/Cargo 包名和应用 exe 文件名仍为 `pixel-record`，Rust 库名仍为 `pixel_record_lib`。保留应用 identifier，使配置和持久化目录授权继续使用原有路径；业务数据目录没有移动。

NSIS 按产品名生成默认安装目录、卸载注册键和快捷方式名称。更名并不保证沿用旧版「像素记录」的安装记录；旧版覆盖升级、自启项迁移需另行实测。详情及本次构建结果见上级 `修改日志.md`。下方旧安装包的路径、哈希和验证结果保留为历史记录。

本次重新构建并交付 `发布/单轨_0.1.0_x64-setup.exe`（相对于 app 根目录）。应用及安装器的 Windows PE 产品名、文件描述均已核验为「单轨」；34 个测试文件、210 项测试、TypeScript 和 ESLint 检查通过。新产物哈希和核验记录见 `修改日志.md` 及 `evidence/rename-monorail/`。

## 从早期验证骨架升级（历史说明）

旧标识为 `local.taskterminal.skeleton`。新标识改变了 `app_config_dir` 和保存目录访问授权的 `app_data_dir`。本次没有自动迁移旧配置：只复制 config.json 无法同时恢复 persisted-scope 的独立目录授权。

首次打开新版时，请重新选择原来的数据文件夹。records、cards、projects、reviews、timelog 和 settings.yaml 都仍在原数据目录，不会因标识改变而移动或删除。不需要新建空数据目录，也不要把旧 app_config_dir 当作数据目录。

## 生产构建

在 app 根目录执行 `npm run tauri build`，使用默认 `tauri.conf.json`、默认生产 Vite 构建，不传 `--features verify` 或 `tauri.verify.conf.json`。构建时 `VITE_VERIFY=false`，避免进程环境意外启用验证入口。Cargo 的 verify 特性没有默认启用；验证命令和单实例触发分支均受 Rust cfg 保护。

NSIS 产物位于 `src-tauri/target/release/bundle/nsis/`，交付副本放在 `app/发布/`，文件名带版本号。构建日志和交付核验结果另见本目录的 release-build.log、release-audit.json；代码检查日志见 release-check.log。

本轮仅验证编译打包、产物存在/大小/哈希以及验证入口未进入生产构建，不运行应用 exe，也不安装或运行安装包；真机安装由用户完成。安装器沿用 Tauri 默认的 WebView2 引导配置，缺少运行时的机器可能需要联网获取它。

## 发布前修复

经 lead 授权，回顾投影 `bet` 增加 `projectId`，ReviewPage 用 ID 定位旧主线；页面类型复用 store 合同。两个项目同名时不会再把另一个项目传给换主线对话框。补充页面组件与服务连续复盘两项回归，源代码不会因为这项修复引入新的 UI 流程。

## 历史交付记录：像素记录 0.1.0

- 构建日期：2026-10-27；生产源码提交：`4673332549ac89a42bb9f97825e69199dd12b0ae`，已包含 M3 全部页面接线及上述修复。
- `npm run check` 通过：34 个测试文件、210 项测试、TypeScript、ESLint。
- `npm run tauri build` 成功生成 Windows x64 NSIS 安装包；Rust release 优化构建成功。仅保留既有第三方 PURE 注释和 bundle 大小提示，没有调整警告阈值。
- 交付文件：`发布/像素记录_0.1.0_x64-setup.exe`（相对于 app 根目录）。大小 **7,797,399 字节，7.436 MiB**；交付副本与原始 bundle 的 SHA-256 完全相同。
- SHA-256：`4eefe21c5deddc1df23ffd8798745eb186ca92e555c9bcd6f1ace681cc72d46b`。
- Windows PE 产品名为「像素记录」，产品与文件版本均为 0.1.0；安装器签名状态为 `NotSigned`。
- Cargo 产物 fingerprint 显示应用未启用 verify，Tauri 已启用 custom-protocol（生产资源嵌入）。扫描 3 个生产 JavaScript 文件与 release 应用二进制，没有验证触发事件/测试标记；生产 capabilities 不含验证权限。
- 应用 exe、安装器均未执行；未进行安装、UI 验收或补做历史冒烟项。安装包是本地交付产物，不放入 Git；源码、日志和核验清单已提交。

# 骨架约定

- 依据上级目录架构设计 v1.0；只实现技术验证，不移植视觉。
- app 是组装根；domain 纯函数；data 管格式与 IO；platform 封装原生能力。
- services 经 commit 串行写入，store 只接提交后的投影。
- record=记录，card=任务卡，segment=计时段，seq=全局写入顺序。
- `npm test` 有进程级 60 秒上限；`npm run check` 为 tsc、eslint、vitest。
- `npm run tauri build -- --no-bundle` 构建可执行文件。
- 工具链使用已安装的 Rust 1.95.0，不更改全局默认。
- `evidence/` 保存真实验证日志；未实测原生行为不得写成通过。

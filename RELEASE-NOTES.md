# OpenClaw Desktop — 0.2.0 Preview

- 改为无边框窗口，移除顶部品牌、地址和连接设置横条。
- 保留 32px 空白拖动区与最小化、最大化/还原、关闭按钮；全屏时隐藏控制区。
- 连接设置从托盘菜单或 Ctrl+L 打开；Ctrl+R 重新加载。
- 保留窗口记忆、关闭到托盘、原版登录配对和页面失败重试。
- Windows 构建流程根据实际版本检查便携 EXE。

下载 `OpenClaw-Desktop-0.2.0-win-x64.exe`，退出旧版本后启动。无需安装 Node.js 或 DSH，继续使用原有本地配置。

**验证状态：** 仅执行非 GUI 检查和 Windows 打包；无边框拖动、窗口按钮、全屏、托盘及真实 Gateway 登录聊天仍需用户在 Windows 验收。未作代码签名。视频背景、开机动画和桌宠尚未包含。

试用清单见 `TRY-WINDOWS.md`；校验值见 `SHA256SUMS`。

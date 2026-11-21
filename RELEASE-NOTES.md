# OpenClaw Desktop — first desktop shell preview

独立 Electron 桌面壳，直接加载原版 OpenClaw Control UI，不修改 DSH 或 Gateway。

## 下载与启动

下载 `OpenClaw-Desktop-0.1.0-win-x64.exe` 并双击运行。无需安装 Node.js 或 DSH。

输入现有 Gateway 的完整地址，在 Control UI 中完成原版登录和设备配对。关闭窗口后从托盘返回；退出请使用托盘菜单。

本阶段包含连接页、原版 UI、持久浏览器会话、窗口记忆、托盘和页面加载失败自动重试。尚未包含视频背景、开机动画、桌宠或任务通知。

**验证状态：** 发布工作流仅执行非 GUI 检查和 Windows 打包。真实 Windows 窗口、托盘、登录配对、聊天与下载体验需用户实测。此包未作代码签名；Windows 可能显示未识别发布者提示。

试用清单见附件 `TRY-WINDOWS.md`，文件校验值见 `SHA256SUMS`。

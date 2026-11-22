# OpenClaw Desktop — 0.4.6 Preview

独立 Electron 桌面壳，加载 Gateway 提供的原版 Control UI。非官方客户端；不修改 DSH、OpenClaw Gateway 或服务器 UI 文件。

## 功能

- 顶部极简网易云心动音乐播放器，支持扫码登录、播放/暂停、喜欢、下一首、连续续队列，展开后显示歌名。

- Gateway 地址、窗口位置与大小记忆；独立持久化分区保存 Control UI 自身的登录与设备身份。
- Windows 窗口控制并入 Control UI 工具栏（透明原生按钮、可拖动空白区），Linux 保留32px本地窗口栏；系统托盘；关闭默认隐藏到托盘，托盘菜单「退出」结束应用。
- 窗口控制配色由主进程每 300ms 在隔离环境读取 Control UI 的 `--bg` / `--text`，跟随实际深浅色并缓存上次配色。
- dsh-video-skin 自带的约 8 秒有声开机动画与约 2 分钟静音循环背景；本地打包，不依赖远程下载。
- 独立的开机动画、声音、背景开关与背景强度；外观面板旁实时预览；本机自动保存。
- 视频失败恢复原版界面；开机动画默认有声播放至结束，画面上不显示按钮、品牌文字或跳过提示，保留首帧/总时长故障超时保护。不伪造 Gateway 认证或 WebSocket 连接状态。
- HTTP 错误、页面超时和加载失败的错误页及退避重试；复制粘贴、右键菜单、缩放和文件下载。

## 使用

退出旧版本后运行 `OpenClaw-Desktop-0.4.6-win-x64.exe`，无需安装 Node.js 或 DSH，需要已有可访问的 Gateway。

输入完整 Gateway URL，例如 `https://claw.example.com`、`http://127.0.0.1:18789` 或自定义路径。不要把 Token 放进地址；登录和设备配对在原版 Control UI 中完成。

| 入口 | 操作 |
| --- | --- |
| 托盘「视频与外观…」 / Ctrl+Shift+V | 外观开关和强度，旁边保留工作区预览 |
| Ctrl+L | 连接设置，连接页也有视频设置入口 |
| Ctrl+R | 重新加载，不重播开机动画 |
| Ctrl+Q / 托盘「退出」 | 彻底退出应用 |
| F11 | 全屏 |

默认启用开机动画、声音、背景，强度 60%。开机设置下次启动生效，背景开关和强度即时应用。动画不支持点击或 Esc 跳过；播放期间打开设置会等待动画结束。刷新、重连、托盘恢复不重播动画。最小化和隐藏到托盘时暂停视频。背景始终静音。

新增「毛玻璃透明度」0–100%滑块，默认78%，独立于背景强度，统一控制导航、工具栏和停靠详情的底色透明度，拖动实时预览并自动保存。

外观面板只改本机，不修改 Gateway 偏好。动态背景铺满 Control UI 视口；主画布按主题适度透明，左侧导航、顶部工具栏与右侧停靠详情使用半透明毛玻璃，菜单、输入框、浮动弹层和设置维持原有配色。关闭背景会移除视频及全部激活的透明覆盖。视频仅完成 UI 适配，未迁移 DSH 宿主接口或安装 DSH 插件。

## 本地数据与边界

`app.getPath('userData')/desktop.json` 保存 Gateway 地址、窗口状态、主题缓存与视频设置，不存 Token；Control UI 自己将登录数据保存在 Chromium 持久化分区。`OPENCLAW_DESKTOP_USER_DATA` 可覆盖数据目录用于隔离测试。

远程页面无 Node、preload 或原生 IPC。桌面壳通过隔离世界只读主题并添加背景 DOM，原生设置只向本地 shell 开放。`oc-video://assets/` 媒体协议仅提供两段随包 MP4，支持 GET/HEAD/Range；该资源协议可绕过页面 CSP 的媒体限制，不关闭 webSecurity，也不向其他本地文件开放访问。

麦克风、摄像头和屏幕捕获权限尚未开放。桌宠、开机自启、自选视频不在当前版本范围。真实连接状态以 Control UI 为准。

## 素材来源

[Something11235/dsh-video-skin](https://github.com/Something11235/dsh-video-skin)，固定版本 `2f954a1d6ac6140880f1a58438ed746f2f7f3da4`，原样复用两段 MP4。来源、SHA256 和 MIT 许可随包保存在 `assets/video/NOTICE.md`、`assets/video/LICENSE.dsh-video-skin`。

## 开发与验证

```sh
npm ci
npm test
npm start
npm run dist:win
npm run dist:linux
```

`npm test` 是纯 Node 非 GUI 测试，覆盖媒体流/范围请求、素材完整性、开关保存、播放生命周期、失败/超时、背景恢复、主进程视图布局及 IPC 边界。测试使用模型桩，不证明 Chromium/Windows 的真实视频解码或视觉兼容。

Linux 不运行 GUI 或虚拟显示测试。Windows 的实际播放、声音、页面透明效果、主题切换与托盘行为由用户按 `TRY-WINDOWS.md` 验收。`npm run test:integration` 仅可在用户自己的有桌面环境的机器上运行，其历史 fixture 也不代替上述验收。

## 维护

- `src/main.cjs`：窗口/托盘/加载/本地设置与生命周期。
- `src/shell.*` / `src/boot.js`：本地设置面板与开机播放。
- `src/background.cjs` / `src/background.css`：隔离背景播放与限定范围的样式覆盖。
- `src/media.cjs`：只读媒体服务；`src/video-config.cjs`：视频配置校验。
- `src/theme-sync.cjs`：只读主题同步；`src/policy.cjs`：URL 与窗口边界。

后续皮肤可在根元素设置 `--desktop-titlebar-bg` / `--desktop-titlebar-text`，优先于页面默认配色。视频或透明皮肤建议提供稳定的不透明颜色，不采样逐帧视频颜色。

## 个人签名（可选）

仅自己使用时，可以在自己的 Windows 上生成专用代码签名证书、签名副本并显式安装当前用户信任。私钥不上传，不关闭系统防护。自签名不保证消除 SmartScreen；工具仅签外层便携 EXE。详见 [PERSONAL-SIGNING.md](docs/PERSONAL-SIGNING.md)，Release 附带说明和脚本。


## 启动速度与两种免安装包

- `OpenClaw-Desktop-0.4.6-win-x64.exe`：单文件便携版。每次完全退出后启动都需要先解压运行时；启动前的耗时会受磁盘、杀毒扫描等本机因素影响。
- `OpenClaw-Desktop-0.4.6-win-x64-unpacked.zip`：免安装目录版。完整解压一次，之后直接运行目录中的 `OpenClaw Desktop.exe`；不要只拖出 EXE。此版本不走单文件原位更新，后续手动解压新包。两种包使用同一用户配置目录。
- v0.4.6 将音乐依赖保留在 app.asar，只解出音乐 Worker 引导文件，避免每次便携启动解压大量依赖散文件。Worker 仍在点播放/登录后才启动，不阻塞主窗口加载。
- 用户数据目录中的 `startup.log` 记录不含 URL、聊天内容或凭据的阶段耗时，可区分进程入口、Electron ready、本地壳显示、开机动画结束、Control UI 加载。它不能独自测量 Electron 启动之前的便携解压耗时；CI 另以 Electron Node 模式对比便携/目录版 bootstrap，不将其冒充 GUI 启动时间。

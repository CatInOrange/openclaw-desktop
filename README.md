# OpenClaw Desktop — 0.2.0 Preview

独立的 Electron 桌面壳，直接加载你的 Gateway 提供的原版 Control UI。非官方客户端；不修改 DSH、OpenClaw Gateway 或服务器上的 UI 文件。

## 当前功能

- Gateway 地址输入、校验、记忆，支持自定义 URL 路径。
- 原版 Control UI 内登录、Token 与设备配对；浏览器数据在独立的持久化分区保存。
- 无边框窗口、32px 精简拖动区及最小化/最大化/关闭按钮；大小/位置/最大化状态记忆、移除显示器后的窗口位置恢复。
- 系统托盘：打开、重新连接、连接设置、退出。关闭窗口默认隐藏到托盘；托盘创建失败时关闭即退出。
- 页面加载超时、网络加载失败、HTTP 4xx/5xx 的错误页面及退避重试（最长间隔 30 秒）。
- Ctrl+L 连接设置、Ctrl+R 重新加载、Ctrl+Q 退出；复制粘贴、文本右键菜单、缩放和文件下载。
- Web 页面不接触 Node 或桌面 IPC；不忽略 TLS 证书错误，不关闭 webSecurity。

**明确边界：** 已移除顶部品牌、地址及连接设置横条；使用托盘菜单或 Ctrl+L 打开设置，Ctrl+R 重新加载。网页加载成功不等于 Gateway 已认证/已连接。WebSocket 的连接、登录、配对与重连状态由原版 Control UI 展示和处理；桌面壳不伪造这些状态。首版尚未接入视频背景、开机动画、桌宠、桌面任务通知或开机自启。

## 使用

Windows 便携版：解压下载文件（若为压缩包）后双击 `OpenClaw-Desktop-0.2.0-win-x64.exe`。此版本不需要安装 Node.js，也不需要安装 DSH；需要已有可访问的 OpenClaw Gateway。

1. 输入 Gateway 的完整地址，如 `https://claw.example.com`、`http://127.0.0.1:18789`。自定义路径输入 `https://example.com/openclaw/`。
2. 不要把 Token 放进地址；如有需要，在 Control UI 中粘贴 Token 并按原版流程完成配对。
3. 关闭主窗口后从系统托盘重新打开；托盘菜单“退出”才会结束应用。

远程连接推荐使用 HTTPS；本机可用 HTTP。只输入你信任的 Gateway 地址。麦克风、摄像头、屏幕捕获等原生权限本阶段未开放，不属于首版验证范围。

## 本地开发

```sh
npm ci
npm start
npm test
# GUI 集成验证仅在用户自己的有桌面环境的机器上执行
npm run test:integration
npm run dist:win
npm run dist:linux
```

发布版不包含 `--no-sandbox`。Windows 使用正常桌面用户运行；Linux 不支持以 root 直接运行发布应用。

## 本地数据

Electron `app.getPath('userData')` 中保存 `desktop.json` 和 Chromium 持久化分区。`desktop.json` 仅含服务器地址和窗口状态，不含 Token；Control UI 的设备身份和登录状态由其自身在浏览器分区存储。数据目录可通过 `OPENCLAW_DESKTOP_USER_DATA` 环境变量覆盖（例如用于隔离测试）。

更换 Gateway 时，浏览器数据按源隔离。返回同一地址时会复用已有登录信息。重置本机身份需退出应用并移走对应数据目录；不要在未确认前删除自己的登录数据。

## 结构与维护

- `src/main.cjs`：窗口、WebContentsView、托盘、连接与重试、IPC 来源校验。
- `src/shell.*`：本地连接页和窗口控制区，不参与远程聊天业务。
- `src/preload.cjs`：仅向本地 shell 提供白名单 API，远程页面没有 preload。
- `src/policy.cjs`：URL/导航/窗口恢复策略。
- `test/`：策略测试，以及真实 Electron + 本地 Gateway fixture 的集成测试。

UI 页面正常加载并不证明所有 Control UI 子功能均已兼容 Electron。真实 Gateway 配对、Windows 托盘呈现、下载体验和安装包运行仍需目标机实测。集成 fixture 不代替这些验证。

## 当前验证状态

3 项非 GUI 策略测试通过。虚拟显示集成尝试在截图阶段失败，未完成其余验证，不计为通过。后续不在构建机器上做 GUI 操作，窗口、托盘、真实 Gateway 登录和聊天由用户按 `TRY-WINDOWS.md` 验证。

### 标题栏主题联动（v0.2.1）

标题栏读取 Control UI 根元素的 `--bg` / `--text` 配色，监听主题属性及样式变化，并缓存最后配色用于下次启动。不修改 Control UI 文件，也不向远程页面暴露窗口控制 API。

视频或透明皮肤可在根元素定义 `--desktop-titlebar-bg` / `--desktop-titlebar-text`，优先于默认页面配色。请使用不透明 RGB 颜色；不采样视频画面。页面首次加载之前使用缓存配色；连接设置页主体仍使用桌面壳原有深色设计。

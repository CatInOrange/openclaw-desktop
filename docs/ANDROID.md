# OpenClaw Android 0.1.2 — 连接版

这是独立 Android 原生壳，使用系统 WebView 加载现有 Gateway Control UI。它不是 Electron APK，也不包含 Windows 的 Node 运行时、视频壁纸或桌宠大素材。

## 安装与连接

- Android 9（API28）及以上，设备需要可用且较新的系统 WebView。
- 安装 `OpenClaw-Android-0.1.2.apk`，按系统要求允许此来源安装。
- 输入手机能访问的 Gateway 地址。手机的 `127.0.0.1` 是手机本身，不是电脑；请使用手机可达的 LAN/VPN/HTTPS 地址。
- 优先使用有效证书的 HTTPS。HTTP 可以由用户明确配置，但 WebCrypto/设备身份等能力受安全上下文限制，不能保证在明文地址下完成认证。
- 登录、设备配对和模型/会话功能仍由原版 Control UI 提供，不修改 Gateway，不把 Token 放入入口地址。

## 首版范围

原生地址设置、入口校验、独立浏览器登录空间、站内浏览与返回、加载错误/重试、系统文档选择及安全外链处理。WebView Cookie/本地存储保留在应用私有数据目录；升级沿用同一 applicationId 和发布签名，不要求每次重新登录。清除应用数据或卸载会清除本机登录。

不同 Gateway origin（协议、主机、有效端口）使用不同 WebView 数据目录，避免跨服务器混用会话。首连可以直接创建对应空间；切换到不同 origin 需要受控退出并重新打开，旧空间仍保留。相同 origin 的路径变化不要求新建登录空间。

首版不支持音乐、锁屏播放、语音录制、摄像头授权、桌宠或后台常驻/消息推送。网页语音按钮不表示应用已授予麦克风权限。附件选择接入系统文档界面，不申请全部存储权限；实际附件上传、键盘和配对体验需真机验收。

## 共用与独立部分

- 服务器 Control UI 由两端共用，不复制前端。
- `shared/core/music-controller.cjs` 是唯一纯业务实现，桌面端通过兼容入口使用；Android 音乐运行时和 Media3 后台服务尚未集成，不声称当前 APK 已执行它。
- `shared/contracts/gateway-cases.json` 同时约束桌面 JS 与 Android Kotlin 地址/origin 策略。
- `assets/icon.png` 是两端图标的唯一源素材，CI 调用 `scripts/sync-android-assets.py` 生成 Android 密度资源，不手工维护两份图标。
- WebView、文件选择、系统返回、生命周期、签名安装属于 Android 适配层。

## 构建与签名

所有编译、打包和交付检查均在 GitHub Actions 执行，不在用户 Linux 主机运行 Gradle/Android 构建，也不运行模拟器或虚拟显示。流程位于 `.github/workflows/android.yml`。

工具链固定 JDK17、Gradle8.11.1（wrapper SHA256固定）、AGP8.9.2、Kotlin2.1.20、compile/target SDK35。该 APK 用于个人侧载验证，不代表已符合应用商店上架要求。

正式发布使用持久私有签名，私钥及密码不在代码、APK、构建产物或聊天里。公开证书指纹在 `shared/android-signing-certificate.sha256`，CI 检查 APK 签名、包名、版本、最低 API、非调试标记、权限与备份限制。后续更新必须延续相同包名/签名并增加 versionCode。

## 真机验收

1. 手机安装、打开、输入可达的 HTTPS Gateway，完成设备配对和登录。
2. 彻底退出再打开，确认保留 Gateway 地址及登录空间。
3. 输入中文、打开/关闭键盘，确认输入框不被挡；切换会话、返回键导航正常。
4. 选择本地图片/文件并发送；取消选择不应卡住网页；外链在浏览器打开。
5. 暂时断网后重试，切后台/旋转后恢复不应反复重建页面或清空登录。
6. 切换不同 origin 时遵循提示重新打开，不应串用登录；切回原 origin 应恢复其私有空间。

非 GUI 编译、JVM测试、lint和APK检查不等同于上述真机验收。首次 APK 重点证明聊天连接闭环，再逐步接入经过独立验证的共享音乐业务。

## 0.1.2 启动修复

根据 HUAWEI PLA-AL10 / Android 12 的异常堆栈，将系统栏外观设置延迟至根视图挂载后，避免提前调用 PhoneWindow.getInsetsController。覆盖安装后若仍进入旧诊断页，点击「清除记录并重试」。真机启动和界面仍需用户验收。

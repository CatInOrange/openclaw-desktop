# 极简网易云播放器可行性调研（2026-11-22）

范围：前半部分为初始调研；文末补充经用户授权的非 GUI 账号实测。未修改正式播放器功能。桌面壳基线 v0.4.4。

## 判断

四个操作（播放、暂停、喜欢、下一首）和歌名展示可用本地独立音频播放器实现。主要不确定性不在 UI，而在账号登录、网易云心动推荐接口与实际播放权限。目前有第三方开源实现，未核实普通桌面壳可直接使用的官方心动模式开放接口，不能称为官方 SDK 或承诺永久稳定。

用户所指的“心动模式”仍需确认：旧歌单智能播放与新版首页同名推荐不能仅凭名称判为相同。当前默认研究旧式歌单＋种子歌曲的智能播放，不能悄悄用私人 FM 或日推代替。

## 一手证据

- [智能播放源码](https://github.com/neteasecloudmusicapienhanced/api-enhanced/blob/main/module/playmode_intelligence_list.js)：请求 `/api/playmode/intelligence/list`，传 songId、playlistId、startMusicId、count。
- [作者接口文档](https://github.com/neteasecloudmusicapienhanced/api-enhanced/blob/main/public/docs/home.md)：心动/智能播放要求登录，id/pid 必传，sid 可选。产品可默认从喜欢歌单取种子，但接口本身并没有“只能用喜欢歌单”的限制证据。
- [音频 URL 源码](https://github.com/neteasecloudmusicapienhanced/api-enhanced/blob/main/module/song_url_v1.js)：音频地址独立取得，推荐列表不等于可播放音频。选官方正常权限分支，不启用第三方解锁、换源或随机地区功能。
- [红心源码](https://github.com/neteasecloudmusicapienhanced/api-enhanced/blob/main/module/like.js)：`/api/radio/like`，支持喜欢及取消喜欢；需要真实账号返回成功后更新状态。
- [扫码创建](https://github.com/neteasecloudmusicapienhanced/api-enhanced/blob/main/module/login_qr_create.js)、[扫码确认](https://github.com/neteasecloudmusicapienhanced/api-enhanced/blob/main/module/login_qr_check.js)：提供登录技术路径；未用用户账号实测。
- [第三方项目声明](https://github.com/neteasecloudmusicapienhanced/api-enhanced/blob/main/README.MD)：明确为第三方 Node.js API，涉及逆向协议，支持直接 Node 调用，不要求另部署公开 API 服务器。集成前仍需核实具体依赖/默认选项。
- [网易云官方 2025 年报](https://www1.hkexnews.hk/listedco/listconews/sehk/2026/0415/2026041501036.pdf)：描述新版心动模式首页布局。未据此判断接口兼容性。

没有找到并核实可用于本产品的官方心动模式开放 API；并非声称网易没有任何官方开放平台。

## 推荐产品边界

- 只在用户点击启用/播放时开始，不默认随 OpenClaw 启动发声。首次扫码登录，后续有效会话一键播放。
- 默认喜欢歌单作推荐上下文并自动取种子，无需每次选择歌曲；空歌单或模式不符时明确提示，不伪装已进入心动模式。
- 四键保留；喜欢状态以服务端确认结果为准，不做本地假收藏。
- 暂停/恢复保留播放位置与当前队列；下一首取下一项，队列不足才补充。
- 自动处理下一首、URL 过期和短暂网络错误；遇权限不足、地区/版权不可播或试听限制时说明原因，按正常账号权限处理；连续失败要停止而不是无限循环。
- 一个全局播放实例，切换会话、刷新 Control UI 不重建；收起面板、隐藏主窗口可继续，彻底退出停止。
- 音乐登录态与 Gateway/Control UI 分开，仅由本机受控音乐层持有；四键直接调用音乐适配器，不经过 Agent、不额外调用模型。
- 不把聊天页面加载、音乐登录或推荐失败串成共同启动前置条件。
- 现有 AliceChat music_action 工具契约虽支持播放、暂停和跳歌，但未暴露心动模式与红心接口，不能假定可直接完整复用。

## 位置建议

1. **首选会话列表底部**：约 200px 宽、两行的小卡，首行歌名，第二行四键；属于全局功能，不占输入框、不新增整窗底栏。侧栏折叠时保留音乐入口，展开浮层。
2. **用户上方箭头**：两候选中更合适，但箭头紧挨“详情”和原生窗口按钮。现有 `workspace-chrome.cjs` 为右上原生按钮保留 144 DIP，不能占用。可在操作按钮左边放紧凑音乐入口，宽窗显示歌名/四键，窄窗折叠。
3. **用户下方箭头（输入框操作行）**：不推荐；与模型、语音、发送操作混杂，挤占输入区域，也让全局播放误显为会话附件。

这只是布局建议。播放器应由桌面壳的本地受控视图承载，远程 Control UI 不获取音乐凭据或原生 API；需在布局层预留空间，而非随意覆盖已有按钮。参考 [Electron 安全建议](https://www.electronjs.org/docs/latest/tutorial/security) 与 [WebContentsView](https://www.electronjs.org/docs/latest/api/web-contents-view)。

## 实施前最小验证

本机扫码登录 → 读取喜欢歌单和种子 → 取正确模式队列 → 连续播放/跳过至少数首当前账号有权播放的歌曲 → 真实红心并刷新 → 暂停恢复 → 隐藏/切换会话不断播。

另验登录失效、空喜欢歌单、不可播/试听歌曲、连续下一首与喜欢串行归属。未做账号实测前只能确认技术路径，不能宣布用户账号已支持、官方新版心动体验等价或所有歌曲均可播。GUI 登录与操作由用户本机验收，本机只做非 GUI 检查与构建。


## 2026-11-22 非 GUI 链路实测

用户已授权扫码登录与红心写入后恢复。验证在 Linux 主机的私有临时目录执行，不要求 Windows；没有启动公开 API 服务，没有改 Gateway 或正式客户端。

### 已确定的 UI

不采用左侧会话列表底部方案。音乐控制条位于原生窗口控制按钮左侧，由 Electron 独立承载，Control UI 仅进行必要布局让位，不修改上游源码。常驻播放/暂停、喜欢、下一首三个按钮，展开后显示歌名等信息。

### 环境与证据

- npm 包：`@neteasecloudmusicapienhanced/api`，实测版本 4.41.1，验证脚本位于本机私有临时目录 `/tmp/oc-music-probe/`；从官方 npm registry 获取，安装时禁用生命周期脚本。
- 直接调用模块，不对外开放 HTTP 服务。依赖日志静默，仅输出允许的状态字段，不输出 Cookie、账号标识、音频签名 URL。
- 扫码状态返回 803；读取账号成功。后续独立 Node 进程复用本机保存的会话，也能成功读取账号。
- 识别 `specialType=5` 且属当前用户的红心歌单：29 首。
- `playmode_intelligence_list` 返回 code=200。多次请求获得 111–115 项，最后一次 114 项，其中 108 项有歌名。说明请求 count=10 不保证返回 10 首，且部分条目缺少 songInfo，集成需做元数据补全与去重，不把这类结果直接显示成空白歌曲。
- 新版 `song_url_v1` 默认 xeapi 失败：缺少公钥；尝试注册公钥仍报 `xeapi public key response missing sk`。改用 eapi 该接口返回 -460。不能称新版播放链路已通过。
- 使用同一依赖提供的旧版 `song_url`，br=128000，按当前账号权限请求，三首均 code=200、非试听、MP3。未启用解锁、换源、随机地区或伪造地域。

| 曲目 ID | HTTP | 下载字节 | MP3 时长 | 全量解码 |
|---|---|---|---|---|
| 3341422001 | 200 | 3056997 | 191.03 秒 | ffmpeg exit=0，无错误 |
| 3435072696 | 200 | 2873133 | 179.54 秒 | ffmpeg exit=0，无错误 |
| 3455228588 | 200 | 3442355 | 215.12 秒 | ffmpeg exit=0，无错误 |

- 红心验证：从推荐中选原先未收藏的一首，like 返回 200，重新请求 likelist 确认存在；finally 取消喜欢并重新查询确认不存在，恢复成功。没有保留额外收藏。
- 账号 Cookie 仅保存私有临时目录、文件权限 0600；不写入本文或仓库。正式客户端需要用户在其电脑重新登录。

### 结论和未验证项

结论：**核心非 GUI 链路可行，可进入 Electron 集成**。成功范围为红心歌单种子智能播放，而不是证明与新版首页心动推荐完全等价。

已证明扫码、跨进程会话复用、智能队列、三首正常权限 MP3 获取及完整解码、红心读写恢复。没有在真实 Electron 音频元素里验证声音、暂停恢复、下一首、媒体 URL 到期刷新、隐藏窗口不断播；这些属于下一阶段。未声称 VIP/无权限/地区限制/空歌单/登录过期等异常分支已通过，也未证明高音质或全部曲目可播。长期会话有效期仍待观察。

正式适配建议：先采用实测通过的普通 MP3 入口，将新版协议失败独立记录，不阻塞登录或推荐功能；需要更高音质时另行验证。续队列按种子与上下文补充并去重；原始返回含缺失元数据条目，需补全后再展示。

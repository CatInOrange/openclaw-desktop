# 桌宠状态映射调研（2026-11-22，设计草案）

未实现、未进行 GUI 验证。依据本机 dsh-pet 0.4.9 源码和 OpenClaw 2026.11.3 安装包的协议文档及运行代码；不是所有事件路径的实测兼容性承诺。

## 已核实的 dsh-pet 能力

源码位置：`/root/.dsh/profiles/web/node_modules/dsh-pet/`。

- `assets/config.jsonc` 的 `animations.events.workStatus` 已有六档，且六个同名 WebM 文件确实存在。
- `src/shared/work-status.ts`：thinking / working / result / waiting / success / error，null 表示空闲。
- `src/host/work-status.ts`：按会话保存状态；展示优先级 waiting > error > working > thinking > result > success，同级取最近事件。不是完全没有并发支持，但输出仅一条展示快照，没有多 Agent 数量与列表。
- `src/host/plugin/work-status-bridge.ts`：working → result 有 5 秒抑制，避免快速工具调用反复重启动画。
- `src/client/pet/card/animation-flow.ts`：互动结束可恢复非终态工作动画；睡眠会压制工作表现。

## OpenClaw 已核实的协议入口

安装根：`/mytemp/.local/share/pnpm/global/5/.pnpm/openclaw@2026.11.3/node_modules/openclaw/`。

- `docs/gateway/protocol/rpc-bootstrap-and-events.md`：sessions.subscribe 可同时订阅总览并取得初始快照；监听必须先于请求，重连后重新订阅与校准。
- sessions.list 的 activeOnly 可筛选运行或排队的会话；必须处理分页。会话之外的内部运行不在索引内。
- `docs/gateway/protocol/rpc-session-control.md`：hasActiveRun 是会话直接活动的权威聚合事实；activeRunIds 只在提供时才是完整精确集合，缺省不等于空集。
- sessions.messages.subscribe 支持逐会话观察其他客户端启动的运行；narration 模式减少文本流量，同时保留生命周期、工具、状态与终态事件。不把 narration 文本用作状态真值。
- agent 的 tool/lifecycle 等事件可提供动作依据；`dist/agentsapi-native-tool-projection-CP_MMgSC.mjs` 可见工具 start、toolCallId、name 及结果投影。覆盖范围仍须按 runtime 做接入验证。
- includeApprovals 显式开启 session.approval，并返回 pending approvalReplay；需要正常会话可见性和 admin 或配对设备 approvals 权限。truncated 回放不能作为完整待处理集合。
- chat 的 final / aborted / error 可区分回复终态；final 不证明整个项目目标完成，也不能独立清除其他运行。
- session.observer 的摘要可能来自 utility model：不作为核心动作状态来源，不为桌宠主动触发额外摘要生成。

## 推荐映射

| 语义 | 素材 | 触发与约束 |
| --- | --- | --- |
| 已确认空闲 | 待机呼吸休闲；可选随机玩耍 | 连接健康、快照完整、无活动及待处理 |
| 活动中，尚无明确工具活动 | 工作状态-思考冒泡 | 仅表示正在响应，不声称能读取内部思考 |
| 工具执行 | 工作状态-忙碌点按 | start 到对应 terminal；按 toolCallId 维护并发集合 |
| 工具返回后的过渡 | 工作状态-清点归档 | 其他工具均已结束且运行仍活动；短暂/合并展示，不代表测试通过 |
| 明确待授权 | 工作状态-原地踱步张望 | 只用权威待处理事实；批准、拒绝、过期后重新计算 |
| 本轮正常结束 | 工作状态-雀跃庆祝 | 短暂反馈，不叫项目完成；其他运行仍忙则不抢主动作 |
| 运行失败 | 工作状态-垂头叹气冒汗 | 一次反馈加异常标记；单工具失败但仍自动修复不判整轮失败 |
| 主动取消 | 回到剩余汇总状态 | 不庆祝，不冒充失败 |
| 断线/证据不足 | 待机呼吸休闲 + 灰色断线/未知标记 | 目前无已核实专用离线素材；不能冒充空闲 |

提问工具的开始/返回不能一般化为持续等待用户。异步提问可能立即返回而问题仍待回答；只有接通结构化未答问题生命周期后才加入 waiting，不能解析自然语言问号猜测。

## 多 Agent 与移植边界

保留透明 WebM 动画、素材配置、播放器与互动逻辑；宿主窗口接入现有 Electron 主进程，不运行上游独立 CLI 的伪 DSH 宿主和第二个 Electron。

新增 Gateway observer → 每会话/运行状态表 → 多 Agent 聚合 → 动画调度四层。渲染器只接收归一化状态与受控跳转，不接收原始凭据或任意命令能力。

按 agentId / sessionKey / sessionId / runId 隔离事实；精确 runId 不可用时保留会话级忙碌，不能编造归属。父会话的子任务活动投影与子会话实体需去重，工作 Agent 数按拥有直接活动的 agentId 去重，子任务数量另列。

主动作优先待处理，其次正在执行；异常主要用一次动作和持久角标，避免历史失败长期遮蔽新工作。多个工作 Agent 仍用同一忙碌素材，加“2 个 Agent 工作中”，不虚构加速忙碌素材。同级焦点保持到安全切换点，不随每条事件抢夺。最后一个已知运行结束也须结合快照完整性，不能直接宣布全局空闲。

先验证普通回复、工具串并行、双 Agent、父子运行、批准与过期、异步提问、取消、失败恢复、断线重连、运行中启动客户端。只在用户 Windows 验证实际窗口、穿透与动画表现。

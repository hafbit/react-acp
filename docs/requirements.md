# react-acp 0.1.x 需求基线

本文是首版实现的中文权威需求记录。目标是提供单一可发布包，将 ACP v1 session 的事件流投影为 assistant-ui runtime、message 和 thread。

## 范围

- ACP session 是线程权威来源；每个 session 一对一对应 assistant-ui thread。
- 支持两种连接：调用方提供 ACP `Stream`，或提供实现稳定 Agent 方法的 `AcpClientAdapter`。
- 核心不启动 Agent、不内置 stdio/WebSocket 网关、数据库或本地权限策略。
- 只承诺 SDK 标记为稳定的 ACP v1；v2 Draft、`UNSTABLE` 方法和字段只作为原始扩展数据保留。
- React 入口使用 assistant-ui `ExternalStoreRuntime`；`/core` 保持纯状态与传输无关；`/primitives` 提供无样式 UI。

## 强约束

- 工作目录和附加目录必须是绝对路径；可选字段按协商能力发送。
- 文件系统按具体注入的方法声明；终端必须完整注入才声明。
- 不伪造 ACP 没有的 rename、archive、edit、regenerate、branch、queue 或 steer。
- 未知事件和 `_meta` 不得丢弃；不能投影的内容必须显式报错或进入 `data-acp-unsupported`。
- 运行中禁止第二个 prompt；取消 turn 时必须取消全部未决权限请求。
- resume 不重放历史；load 以 Agent 重放事件替换本地历史。

## 发布边界

本仓库生成 `@hafbit/react-acp@0.1.0` 发布产物。无 scope 的 `react-acp` 被 npm 相似名称策略拒绝后，维护者已确认改用组织 scope；首次发布仍由维护者通过 2FA 手工执行。

## 0.1.2 生命周期加固补充

- 每个新连接都必须重新挂载 active session；旧连接的通知、关闭回调和异步结果全部丢弃。
- session 选择遵循 latest-selection-wins；load 失败恢复消息快照和原 active session，并可重试。
- 未挂载或挂载失败的 session 禁止 prompt；prompt 传输失败回到 idle，消息保留错误供重试。
- 乐观用户消息不伪造协议通知；匹配的 live user echo 合并到稳定本地消息，协议 ID 单独保存。
- 原始通知按消息、工具和 session 最新状态归属保存，不保留 session 全量日志，不向每条消息复制全量通知。
- session list 完整分页并对账非 active session；close 保留缓存，delete 才移除；生命周期方法一致更新受控 thread 回调。
- Provider identity 配置通过 React `key` 重建，动态回调无需重建；不增加 ACP/assistant-ui 均不存在的公开状态。

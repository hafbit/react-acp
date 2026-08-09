# Codex ACP / OpenCode ACP 人工 smoke 清单

smoke 不进入常规 CI，也不在缺少本地 Agent 时报告成功。

1. 准备能产生 ACP Stream 的宿主，设置 `ACP_SMOKE_AGENT=codex` 或 `opencode`，并设置对应宿主命令。
2. 完成 initialize，记录 protocolVersion、agentInfo 和 capabilities。
3. 创建 session，发送文本 prompt，确认 chunk、tool、permission、plan、usage 和 stop reason 投影；Agent 回传 `user_message_chunk` 时界面只能出现一条用户消息，协议 ID 与本地 ID 分别保留。
4. 若 initialize 返回 `authMethods`，分别验证 `authentication/status` 已登录时不显示登录面板、`unauthenticated` 时显示；断开并重连后再次确认状态。随后确认 auth→load 流程、缓存历史保持可见且下一次 prompt 发往已挂载 session。Agent 不支持状态扩展时应兼容传统认证门控；不支持 load/resume 时应明确报错并禁止发送。
5. 快速发起 A→B session 切换并让 A 较晚完成，确认 active 始终为 B，A 历史只归属 A；制造 load 失败后确认快照恢复且可重试。
6. 若声明 list/load/resume/delete/close，逐项执行；确认分页刷新能发现新增/删除 session，active session 不因瞬时列表缺失而消失，resume 不显示伪造历史。
7. 触发取消和 close，确认该 session 所有未决 permission 收到 cancelled response；受控 thread 回调与 active ID 同步。
8. 关闭连接，确认 terminal、文件句柄与子进程全部释放；旧连接随后到达的 notification 不改变界面。

仓库脚本只做前置条件检查并输出明确的 `SKIP` 或待执行命令，不会替代宿主集成。

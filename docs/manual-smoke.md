# Codex ACP / OpenCode ACP 人工 smoke 清单

smoke 不进入常规 CI，也不在缺少本地 Agent 时报告成功。

1. 准备能产生 ACP Stream 的宿主，设置 `ACP_SMOKE_AGENT=codex` 或 `opencode`，并设置对应宿主命令。
2. 完成 initialize，记录 protocolVersion、agentInfo 和 capabilities。
3. 创建 session，发送文本 prompt，确认 chunk、tool、permission、plan、usage 和 stop reason 投影。
4. 若声明 list/load/resume/delete/close，逐项执行；确认 resume 不显示伪造历史。
5. 触发取消并确认所有未决 permission 收到 cancelled response。
6. 关闭连接，确认 terminal、文件句柄与子进程全部释放。

仓库脚本只做前置条件检查并输出明确的 `SKIP` 或待执行命令，不会替代宿主集成。

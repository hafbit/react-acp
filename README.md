# react-acp

`react-acp` 将 [Agent Client Protocol (ACP)](https://agentclientprotocol.com/) 会话投影为 [assistant-ui](https://www.assistant-ui.com/) runtime。ACP session 是线程权威来源；消息、推理、工具调用、权限、计划、模式、配置与用量由协议事件驱动。

> 当前状态：`0.1.0` 开发版。兼容承诺覆盖官方 TypeScript SDK 标记为稳定的 ACP v1 API；实验 API 与 ACP v2 Draft 不在承诺范围内。

## 安装

```bash
pnpm add react-acp @assistant-ui/react react
```

## 最小用法

```tsx
import { AssistantRuntimeProvider } from "@assistant-ui/react";
import { useAcpRuntime } from "react-acp";

export function AcpProvider({ children }: { children: React.ReactNode }) {
  const runtime = useAcpRuntime({
    connection: {
      type: "stream",
      createStream: ({ signal }) => connectYourTransport(signal),
    },
    workspace: { cwd: "/absolute/project/path", mcpServers: [] },
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      {children}
    </AssistantRuntimeProvider>
  );
}
```

浏览器不能直接启动本地 stdio Agent。浏览器应用应由宿主注入 WebSocket/HTTP Stream，或注入自定义 `AcpClientAdapter`。本包不会替应用获得文件系统或终端权限。

高层 adapter、纯 reducer/projector 和结构化错误从 `react-acp/core` 导出；认证、计划、模式、配置、命令、权限和 ACP artifact 的无样式组件从 `react-acp/primitives` 导出。主入口同时提供对应 hooks。

设计与验收资料：

- [需求基线](./docs/requirements.md)
- [架构设计](./docs/architecture.md)
- [ACP v1 能力矩阵](./docs/protocol-capability-matrix.md)
- [Codex/OpenCode 人工 smoke](./docs/manual-smoke.md)
- [版本发布与 npm OIDC](./docs/releasing.md)

完整可控示例位于 `examples/vite`：

```bash
pnpm install
pnpm --dir examples/vite dev
```

## English

`react-acp` is a transport-agnostic ACP v1 runtime adapter for assistant-ui. It projects ACP sessions, messages, reasoning, tools, permissions, plans, modes, config options, and usage into assistant-ui state while preserving raw ACP metadata.

The package does not launch agents, provide a gateway, persist sessions, or grant filesystem/terminal access. Applications inject either an ACP `Stream` factory or an `AcpClientAdapter`.

Install and use the same minimal provider API:

```bash
pnpm add react-acp @assistant-ui/react react
```

```tsx
const runtime = useAcpRuntime({
  connection: { type: "adapter", adapter: yourAcpAdapter },
  workspace: { cwd: "/absolute/project/path" },
});

return <AssistantRuntimeProvider runtime={runtime}>{children}</AssistantRuntimeProvider>;
```

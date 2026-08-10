# react-acp

`react-acp` 将 [Agent Client Protocol (ACP)](https://agentclientprotocol.com/) 会话投影为 [assistant-ui](https://www.assistant-ui.com/) runtime。ACP session 是线程权威来源；消息、推理、工具调用、权限、计划、模式、配置与用量由协议事件驱动。

> 当前状态：`0.1.2` 开发版。兼容承诺覆盖官方 TypeScript SDK 标记为稳定的 ACP v1 API；实验 API 与 ACP v2 Draft 不在承诺范围内。

## 安装

从 npm 安装：

```bash
pnpm add @hafbit/react-acp @assistant-ui/react react
```

或从 [JSR](https://jsr.io/@hafbit/react-acp) 安装同一版本的 TypeScript
源码包：

```bash
pnpm add jsr:@hafbit/react-acp @assistant-ui/react react
```

## 最小用法

```tsx
import { AssistantRuntimeProvider } from "@assistant-ui/react";
import { useAcpRuntime } from "@hafbit/react-acp";

export function AcpProvider({ children }: { children: React.ReactNode }) {
  const runtime = useAcpRuntime({
    connection: {
      type: "stream",
      createStream: ({ signal }) => connectYourTransport(signal),
    },
    workspace: { cwd: "/absolute/project/path", mcpServers: [] },
  });

  return <AssistantRuntimeProvider runtime={runtime}>{children}</AssistantRuntimeProvider>;
}
```

浏览器不能直接启动本地 stdio Agent。浏览器应用应由宿主注入 WebSocket/HTTP Stream，或注入自定义 `AcpClientAdapter`。本包不会替应用获得文件系统或终端权限。

高层 adapter、纯 reducer/projector 和结构化错误从 `@hafbit/react-acp/core` 导出；认证、计划、模式、配置、命令、权限和 ACP artifact 的无样式组件从 `@hafbit/react-acp/primitives` 导出。主入口同时提供对应 hooks。

`connection`、`workspace`、`clientServices`、`clientCapabilities` 和 `clientInfo` 是 Provider 的身份配置。切换 Agent 或 Workspace 时用 React `key` 重建 Provider；`threadId` 是标准受控属性，`onError`、`onThreadIdChange` 等回调可动态更新：

```tsx
function AgentRuntime({ agent, workspace, children }: Props) {
  return (
    <AcpProvider key={`${agent.id}:${workspace.cwd}`} agent={agent} workspace={workspace}>
      {children}
    </AcpProvider>
  );
}
```

`useAcpRuntimeExtras()` 提供 `reconnect`、完整分页的 `refreshSessions` 和 session 生命周期方法。消息 metadata 只保留该消息自己的完整 ACP notifications；session 最新状态、工具通知和未知扩展通过 extras 中的公开 core state 读取。

应用可以通过 `extensions` 注入 `AcpRuntimeExtensionAdapter`，解释自身拥有的私有
`_meta`：`sessionAccess` 决定 load/resume 后的读写能力，`messagePhase` 决定消息分段。
本包默认不识别任何厂商命名空间，未知字段和原始 `_meta` 始终保留。

## 入口与 API

| 入口                           | 适用场景                         | 主要导出                                                                                 |
| ------------------------------ | -------------------------------- | ---------------------------------------------------------------------------------------- |
| `@hafbit/react-acp`            | React 应用的常规集成             | `useAcpRuntime`、ACP hooks、常用无样式组件与公开类型                                     |
| `@hafbit/react-acp/core`       | 自定义宿主、transport 或状态投影 | `AcpThreadController`、`SdkAcpClientAdapter`、reducer、projector、serializer、错误和类型 |
| `@hafbit/react-acp/primitives` | 自定义 ACP 交互界面              | 认证、权限、计划、模式、配置、命令、用量、Diff、Terminal、Resource 和 Unsupported 组件   |

```tsx
import { useAcpRuntime } from "@hafbit/react-acp";
import { AcpThreadController } from "@hafbit/react-acp/core";
import { AcpPermissionList } from "@hafbit/react-acp/primitives";
```

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

The package exposes three entrypoints: the default React runtime and hooks,
`@hafbit/react-acp/core` for headless integration, and
`@hafbit/react-acp/primitives` for unstyled ACP UI components.

Install and use the same minimal provider API:

```bash
pnpm add @hafbit/react-acp @assistant-ui/react react
```

The same TypeScript source package is also published on
[JSR](https://jsr.io/@hafbit/react-acp):

```bash
pnpm add jsr:@hafbit/react-acp @assistant-ui/react react
```

```tsx
const runtime = useAcpRuntime({
  connection: { type: "adapter", adapter: yourAcpAdapter },
  workspace: { cwd: "/absolute/project/path" },
});

return <AssistantRuntimeProvider runtime={runtime}>{children}</AssistantRuntimeProvider>;
```

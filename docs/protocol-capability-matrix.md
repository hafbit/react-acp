# ACP v1 稳定能力矩阵

状态含义：`实现`为直接支持；`能力门控`为仅在 initialize 声明后开放；`不适用`为协议没有对应语义且不会伪造。

| ACP v1 能力 | 状态 | 实现位置 | 测试证据 |
| --- | --- | --- | --- |
| initialize / 版本协商 | 实现 | `SdkAcpClientAdapter`、controller | `stream-conformance.test.ts` |
| authenticate / logout | 实现 | controller、认证 hook/primitive | `controller.test.ts` |
| session/new | 实现 | controller | `controller.test.ts` |
| session/prompt / cancel | 实现 | controller | `controller.test.ts` |
| session/update 内容流 | 实现 | reducer/projector | `state.test.ts`、`projection.test.ts` |
| session/load | 能力门控 | `loadSession` | `controller.test.ts` |
| session/list + 全分页 | 能力门控 | `sessionCapabilities.list` | `controller.test.ts` |
| session/delete | 能力门控 | `sessionCapabilities.delete` | `controller.test.ts` |
| session/resume | 能力门控 | `sessionCapabilities.resume` | `controller.test.ts` |
| session/close | 能力门控 | `sessionCapabilities.close` | `controller.test.ts` |
| additionalDirectories | 能力门控 | `sessionCapabilities.additionalDirectories` | `serialize.test.ts` |
| 文本 / resource link prompt | 实现 | serializer | `serialize.test.ts` |
| 图片 / 音频 / embedded resource prompt | 能力门控 | `promptCapabilities` | `serialize.test.ts` |
| tool call / 增量 update | 实现 | reducer/projector | `state.test.ts` |
| permission request | 实现 | controller / tool approval | `controller.test.ts`、`projection.test.ts` |
| plan / commands | 实现 | reducer / hooks / primitives | `state.test.ts` |
| session modes | 实现 | controller / primitives | `controller.test.ts` |
| session config options | 实现 | controller / primitives | `controller.test.ts` |
| usage update | 实现 | reducer / hook / primitive | `state.test.ts` |
| Client fs/read_text_file | 按注入声明 | SDK adapter | `stream-conformance.test.ts`、`serialize.test.ts` |
| Client fs/write_text_file | 按注入声明 | SDK adapter | `stream-conformance.test.ts`、`serialize.test.ts` |
| Client terminal 全组方法 | 按整组注入声明 | SDK adapter | `stream-conformance.test.ts`、`serialize.test.ts` |
| `_meta` / 未知扩展 | 实现 | reducer/projector | `state.test.ts`、`projection.test.ts` |
| rename / archive / edit / regenerate / branch | 不适用 | 对应 runtime 能力关闭 | `runtime.test.tsx`、构建检查 |
| v2 Draft / `UNSTABLE` | 不承诺 | 作为 raw/unsupported 保留 | `state.test.ts` |

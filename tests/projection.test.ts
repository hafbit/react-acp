import { describe, expect, it } from "vitest";
import { createAcpThreadState, reduceAcpThreadState } from "../src/core/state";
import { projectAcpThreadMessages } from "../src/core/projection";

describe("ACP message projection", () => {
  it("投影文本、reasoning、音频、resource 和原始元数据", () => {
    let state = createAcpThreadState();
    for (const update of [
      {
        sessionUpdate: "agent_message_chunk" as const,
        messageId: "m1",
        content: { type: "text" as const, text: "answer" },
        _meta: { traceId: "trace-1" },
      },
      {
        sessionUpdate: "agent_thought_chunk" as const,
        messageId: "m1",
        content: { type: "text" as const, text: "thinking" },
      },
      {
        sessionUpdate: "agent_message_chunk" as const,
        messageId: "m1",
        content: { type: "audio" as const, data: "YWJj", mimeType: "audio/wav" },
      },
      {
        sessionUpdate: "agent_message_chunk" as const,
        messageId: "m1",
        content: {
          type: "resource_link" as const,
          uri: "https://example.test/a",
          name: "source",
        },
      },
    ]) {
      state = reduceAcpThreadState(state, {
        type: "session.update",
        notification: {
          sessionId: "s1",
          update,
          _meta: { envelope: "kept" },
        },
      });
    }
    state = reduceAcpThreadState(state, {
      type: "session.prompt_stopped",
      sessionId: "s1",
      response: { stopReason: "max_tokens" },
    });

    const message = projectAcpThreadMessages(state, "s1")[0]!;
    expect(message.content).toMatchObject([
      { type: "text", text: "answer" },
      { type: "reasoning", text: "thinking" },
      { type: "file", mimeType: "audio/wav" },
      { type: "source", url: "https://example.test/a" },
    ]);
    expect(message.status).toEqual({ type: "incomplete", reason: "length" });
    expect(message.metadata?.custom?.acp).toMatchObject({
      sessionId: "s1",
      stopReason: "max_tokens",
    });
    expect(JSON.stringify(message.metadata?.custom?.acp)).toContain("trace-1");
    expect(JSON.stringify(message.metadata?.custom?.acp)).toContain("kept");
  });

  it("将工具权限映射为 assistant-ui approval，并保留 artifact", () => {
    const state = reduceAcpThreadState(createAcpThreadState(), {
      type: "permission.requested",
      request: {
        sessionId: "s1",
        toolCall: {
          toolCallId: "t1",
          title: "Edit file",
          kind: "edit",
          rawInput: { path: "/tmp/a" },
        },
        options: [
          { optionId: "yes", name: "Allow", kind: "allow_once" },
          { optionId: "no", name: "Reject", kind: "reject_once" },
        ],
      },
    });
    const part = projectAcpThreadMessages(state, "s1")[0]?.content[0];
    expect(part).toMatchObject({
      type: "tool-call",
      toolCallId: "t1",
      toolName: "acp:edit",
      args: { path: "/tmp/a" },
      approval: {
        id: "t1",
        options: [
          { id: "yes", kind: "allow-once" },
          { id: "no", kind: "reject-once" },
        ],
      },
      artifact: { acp: { title: "Edit file", kind: "edit" } },
    });
  });
});

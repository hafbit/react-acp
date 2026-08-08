import type { SessionUpdate } from "@agentclientprotocol/sdk";
import { describe, expect, it } from "vitest";
import {
  createAcpThreadState,
  reduceAcpThreadState,
} from "../src/core/state";

const update = (sessionId: string, value: SessionUpdate) => ({
  type: "session.update" as const,
  notification: { sessionId, update: value },
});

describe("reduceAcpThreadState", () => {
  it("按 messageId 合并分块，并在缺失时生成稳定本地 ID", () => {
    let state = createAcpThreadState();
    state = reduceAcpThreadState(state, update("s1", {
      sessionUpdate: "agent_message_chunk",
      messageId: "m1",
      content: { type: "text", text: "hel" },
      _meta: { trace: "a" },
    }));
    state = reduceAcpThreadState(state, update("s1", {
      sessionUpdate: "agent_message_chunk",
      messageId: "m1",
      content: { type: "text", text: "lo" },
    }));
    state = reduceAcpThreadState(state, update("s2", {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "isolated" },
    }));

    expect(state.sessions.s1?.messages).toHaveLength(1);
    expect(state.sessions.s1?.messages[0]?.id).toBe("m1");
    expect(state.sessions.s1?.messages[0]?.pieces).toHaveLength(2);
    expect(state.sessions.s2?.messages[0]?.id).toBe("s2:turn:0:assistant:0");
  });

  it("接受先于 tool_call 到达的 update，并增量合并", () => {
    let state = createAcpThreadState();
    state = reduceAcpThreadState(state, update("s1", {
      sessionUpdate: "tool_call_update",
      toolCallId: "tool-1",
      status: "in_progress",
      rawOutput: { partial: true },
    }));
    state = reduceAcpThreadState(state, update("s1", {
      sessionUpdate: "tool_call",
      toolCallId: "tool-1",
      title: "Read file",
      kind: "read",
      status: "completed",
      rawInput: { path: "/tmp/a" },
    }));

    const tool = state.sessions.s1?.tools["tool-1"];
    expect(tool?.value).toMatchObject({
      title: "Read file",
      status: "completed",
      rawInput: { path: "/tmp/a" },
      rawOutput: { partial: true },
    });
    expect(tool?.rawUpdates).toHaveLength(2);
  });

  it("权限可先于工具事件到达并投影到占位工具", () => {
    const state = reduceAcpThreadState(createAcpThreadState(), {
      type: "permission.requested",
      request: {
        sessionId: "s1",
        toolCall: {
          toolCallId: "tool-1",
          title: "Run command",
          kind: "execute",
          status: "pending",
        },
        options: [
          { optionId: "once", name: "Allow once", kind: "allow_once" },
          { optionId: "deny", name: "Reject", kind: "reject_once" },
        ],
      },
    });

    expect(state.sessions.s1?.tools["tool-1"]?.permission?.status).toBe("pending");
    expect(state.sessions.s1?.messages[0]?.pieces).toContainEqual({
      type: "tool",
      toolCallId: "tool-1",
    });
  });

  it.each([
    ["end_turn", "complete"],
    ["max_tokens", "incomplete"],
    ["cancelled", "incomplete"],
    ["refusal", "incomplete"],
    ["max_turn_requests", "incomplete"],
  ] as const)("映射 stop reason %s", (stopReason, expected) => {
    let state = createAcpThreadState();
    state = reduceAcpThreadState(state, update("s1", {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "done" },
    }));
    state = reduceAcpThreadState(state, {
      type: "session.prompt_stopped",
      sessionId: "s1",
      response: { stopReason },
    });
    expect(state.sessions.s1?.messages[0]?.status?.type).toBe(expected);
    expect(state.sessions.s1?.messages[0]?.status).toMatchObject({ stopReason });
  });

  it("加载历史前替换本地投影且不污染其他会话", () => {
    let state = createAcpThreadState();
    state = reduceAcpThreadState(state, update("s1", {
      sessionUpdate: "user_message_chunk",
      content: { type: "text", text: "old" },
    }));
    state = reduceAcpThreadState(state, update("s2", {
      sessionUpdate: "user_message_chunk",
      content: { type: "text", text: "keep" },
    }));
    state = reduceAcpThreadState(state, { type: "session.loading", sessionId: "s1" });
    expect(state.sessions.s1?.messages).toEqual([]);
    expect(state.sessions.s2?.messages).toHaveLength(1);
  });

  it("未知扩展进入 unhandledEvents 而不崩溃", () => {
    const state = reduceAcpThreadState(createAcpThreadState(), update("s1", {
      sessionUpdate: "vendor_extension",
      payload: { answer: 42 },
    } as unknown as SessionUpdate));
    expect(state.sessions.s1?.unhandledEvents).toHaveLength(1);
    expect(state.sessions.s1?.messages[0]?.pieces[0]).toMatchObject({
      type: "unsupported",
    });
  });

  it("保存计划、命令、模式、配置和用量状态", () => {
    let state = reduceAcpThreadState(createAcpThreadState(), {
      type: "session.opened",
      sessionId: "s1",
      modes: {
        currentModeId: "ask",
        availableModes: [
          { id: "ask", name: "Ask" },
          { id: "code", name: "Code" },
        ],
      },
    });
    for (const value of [
      {
        sessionUpdate: "plan" as const,
        entries: [
          { content: "Implement", priority: "high" as const, status: "in_progress" as const },
        ],
      },
      {
        sessionUpdate: "available_commands_update" as const,
        availableCommands: [
          { name: "review", description: "Review changes", input: null },
        ],
      },
      { sessionUpdate: "current_mode_update" as const, currentModeId: "code" },
      {
        sessionUpdate: "config_option_update" as const,
        configOptions: [
          {
            type: "boolean" as const,
            id: "safe",
            name: "Safe",
            category: "mode",
            currentValue: true,
          },
        ],
      },
      {
        sessionUpdate: "usage_update" as const,
        used: 12,
        size: 100,
      },
    ]) {
      state = reduceAcpThreadState(state, update("s1", value));
    }
    expect(state.sessions.s1).toMatchObject({
      plan: { entries: [{ content: "Implement" }] },
      commands: [{ name: "review" }],
      modes: { currentModeId: "code" },
      configOptions: [{ id: "safe", currentValue: true }],
      usage: { used: 12, size: 100 },
    });
  });

  it("乐观消息失败后保留消息、错误和失败状态", () => {
    let state = reduceAcpThreadState(createAcpThreadState(), {
      type: "message.optimistic",
      sessionId: "s1",
      message: {
        id: "local-1",
        role: "user",
        createdAt: 1,
        optimistic: true,
        pieces: [],
      },
    });
    state = reduceAcpThreadState(state, {
      type: "message.optimistic_failed",
      sessionId: "s1",
      messageId: "local-1",
      error: new Error("network"),
    });
    expect(state.sessions.s1?.messages[0]).toMatchObject({
      id: "local-1",
      optimistic: false,
      error: expect.any(Error),
    });
  });
});

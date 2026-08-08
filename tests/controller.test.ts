import type { AppendMessage } from "@assistant-ui/react";
import { PROTOCOL_VERSION } from "@agentclientprotocol/sdk";
import { describe, expect, it, vi } from "vitest";
import { AcpThreadController } from "../src/core/controller";
import { ConformanceAdapter } from "./fixture";

describe("AcpThreadController conformance fixture", () => {
  it("初始化、遍历 session/list 分页并加载历史", async () => {
    const adapter = new ConformanceAdapter();
    const onThreadIdChange = vi.fn();
    const controller = new AcpThreadController({
      connection: { type: "adapter", adapter },
      workspace: { cwd: "/workspace", additionalDirectories: ["/shared"] },
      onThreadIdChange,
    });

    await controller.connect();
    expect(controller.getState().connectionStatus).toBe("ready");
    expect(controller.getState().sessionOrder).toEqual(["s1", "s2"]);
    expect(adapter.connection.listSessions).toHaveBeenCalledTimes(2);

    await controller.selectSession("s1");
    expect(controller.getState().sessions.s1?.messages[0]?.id).toBe("history-user");
    expect(adapter.connection.loadSession).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "s1",
        cwd: "/workspace",
        additionalDirectories: ["/shared"],
      }),
    );
    expect(onThreadIdChange).toHaveBeenCalledWith("s1");
  });

  it("乐观发送、流式响应并完成 turn", async () => {
    const adapter = new ConformanceAdapter();
    const controller = new AcpThreadController({
      connection: { type: "adapter", adapter },
      workspace: { cwd: "/workspace" },
    });
    await controller.connect();
    await controller.selectSession("s1");
    await controller.sendMessage({
      role: "user",
      content: [{ type: "text", text: "hello" }],
    } as unknown as AppendMessage);

    const session = controller.getState().sessions.s1!;
    expect(session.messages.some((message) => message.optimistic)).toBe(true);
    expect(session.messages.find((message) => message.id === "agent-answer")?.status)
      .toEqual({ type: "complete", stopReason: "end_turn" });
    expect(adapter.connection.prompt).toHaveBeenCalledWith({
      sessionId: "s1",
      prompt: [{ type: "text", text: "hello" }],
    });
  });

  it("权限请求与取消均完整响应", async () => {
    const adapter = new ConformanceAdapter();
    const controller = new AcpThreadController({
      connection: { type: "adapter", adapter },
      workspace: { cwd: "/workspace" },
    });
    await controller.connect();

    const permission = adapter.handlers!.requestPermission(
      {
        sessionId: "s1",
        toolCall: { toolCallId: "t1", title: "Run", kind: "execute" },
        options: [{ optionId: "yes", name: "Allow", kind: "allow_once" }],
      },
      new AbortController().signal,
    );
    await controller.replyToPermission("s1", "t1", "yes");
    await expect(permission).resolves.toEqual({
      outcome: { outcome: "selected", optionId: "yes" },
    });

    const pending = adapter.handlers!.requestPermission(
      {
        sessionId: "s1",
        toolCall: { toolCallId: "t2", title: "Delete", kind: "delete" },
        options: [{ optionId: "no", name: "Reject", kind: "reject_once" }],
      },
      new AbortController().signal,
    );
    await controller.cancel("s1");
    await expect(pending).resolves.toEqual({ outcome: { outcome: "cancelled" } });
    expect(adapter.connection.cancel).toHaveBeenCalledWith("s1");
  });

  it("能力门控生命周期、模式和配置调用", async () => {
    const adapter = new ConformanceAdapter();
    const controller = new AcpThreadController({
      connection: { type: "adapter", adapter },
      workspace: { cwd: "/workspace" },
    });
    await controller.connect();
    const newSessionId = await controller.createSession();
    expect(newSessionId).toBe("new-session");
    await controller.resumeSession("s1");
    await controller.closeSession("s1");
    await controller.setMode(newSessionId, "ask");
    await controller.setConfigOption(newSessionId, "safe", true);
    await controller.deleteSession("s2");

    expect(adapter.connection.resumeSession).toHaveBeenCalled();
    expect(adapter.connection.closeSession).toHaveBeenCalledWith("s1");
    expect(adapter.connection.setSessionMode).toHaveBeenCalledWith({
      sessionId: "new-session",
      modeId: "ask",
    });
    expect(controller.getState().sessions["new-session"]?.configOptions[0]).toMatchObject({
      id: "safe",
      currentValue: true,
    });
    expect(controller.getState().sessions.s2).toBeUndefined();
  });

  it("认证门控并支持 authenticate/logout", async () => {
    const adapter = new ConformanceAdapter();
    adapter.connection.initialize = vi.fn(async () => ({
      protocolVersion: PROTOCOL_VERSION,
      agentCapabilities: { auth: { logout: {} } },
      authMethods: [{ id: "login", name: "Login" }],
    }));
    const controller = new AcpThreadController({
      connection: { type: "adapter", adapter },
      workspace: { cwd: "/workspace" },
    });
    await controller.connect();
    expect(controller.getState().connectionStatus).toBe("auth-required");
    await controller.authenticate("login");
    expect(adapter.connection.authenticate).toHaveBeenCalledWith("login");
    expect(controller.getState().connectionStatus).toBe("ready");
    await controller.logout();
    expect(controller.getState().connectionStatus).toBe("auth-required");
  });
});

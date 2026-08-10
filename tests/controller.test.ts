import type { AppendMessage } from "@assistant-ui/react";
import { PROTOCOL_VERSION, RequestError } from "@agentclientprotocol/sdk";
import { describe, expect, it, vi } from "vitest";
import { AcpThreadController } from "../src/core/controller";
import type {
  AcpAdapterConnectOptions,
  AcpClientAdapter,
  AcpClientConnection,
} from "../src/core/types";
import { ConformanceAdapter } from "./fixture";

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

class ReconnectingAdapter implements AcpClientAdapter {
  readonly handlers: AcpAdapterConnectOptions["handlers"][] = [];
  readonly connections: AcpClientConnection[] = [];
  readonly loads: string[] = [];
  supportsLoad = true;
  authStatus?: { readonly type: string };

  async connect(options: AcpAdapterConnectOptions): Promise<AcpClientConnection> {
    const index = this.connections.length;
    const lifecycle = new AbortController();
    this.handlers.push(options.handlers);
    const connection: AcpClientConnection = {
      signal: lifecycle.signal,
      initialize: vi.fn(async () => ({
        protocolVersion: PROTOCOL_VERSION,
        agentCapabilities: {
          loadSession: this.supportsLoad,
          sessionCapabilities: { list: {} },
        },
        ...(this.authStatus ? { authMethods: [{ id: "chat-gpt", name: "ChatGPT" }] } : {}),
      })),
      ...(this.authStatus ? { authenticationStatus: vi.fn(async () => this.authStatus!) } : {}),
      authenticate: vi.fn(async () => {}),
      logout: vi.fn(async () => {}),
      newSession: vi.fn(async () => ({ sessionId: "created" })),
      loadSession: vi.fn(async ({ sessionId }: { sessionId: string }) => {
        this.loads.push(`${index}:${sessionId}`);
        await options.handlers.sessionUpdate({
          sessionId,
          update: {
            sessionUpdate: "user_message_chunk",
            messageId: `history-${index}`,
            content: { type: "text", text: `history-${index}` },
          },
        });
        return {};
      }),
      listSessions: vi.fn(async () => ({
        sessions: [{ sessionId: "s1", cwd: "/workspace" }],
      })),
      deleteSession: vi.fn(async () => {}),
      resumeSession: vi.fn(async () => ({})),
      closeSession: vi.fn(async () => {}),
      setSessionMode: vi.fn(async () => {}),
      setSessionConfigOption: vi.fn(async () => ({ configOptions: [] })),
      prompt: vi.fn(async () => ({ stopReason: "end_turn" as const })),
      cancel: vi.fn(async () => {}),
      close: vi.fn(() => lifecycle.abort()),
    };
    options.signal.addEventListener("abort", () => lifecycle.abort(), { once: true });
    this.connections.push(connection);
    return connection;
  }
}

describe("AcpThreadController conformance fixture", () => {
  it("仅通过应用扩展解释 session access，默认不识别私有 _meta", async () => {
    const metadata = {
      hafbit: { sessionAccess: { mode: "read-only", reason: "active elsewhere" } },
      unknown: { kept: true },
    };
    const defaultAdapter = new ConformanceAdapter();
    defaultAdapter.connection.loadSession = vi.fn(async () => ({ _meta: metadata }));
    const defaultController = new AcpThreadController({
      connection: { type: "adapter", adapter: defaultAdapter },
      workspace: { cwd: "/workspace" },
    });
    await defaultController.connect();
    await defaultController.selectSession("s1");
    expect(defaultController.getState().sessions.s1?.access).toEqual({ mode: "read-write" });

    const extendedAdapter = new ConformanceAdapter();
    extendedAdapter.connection.loadSession = vi.fn(async () => ({ _meta: metadata }));
    const sessionAccess = vi.fn(({ response }: { response: { _meta?: unknown } }) => {
      const meta = response._meta as typeof metadata;
      return {
        mode: "read-only" as const,
        reason: meta.hafbit.sessionAccess.reason,
      };
    });
    const extendedController = new AcpThreadController({
      connection: { type: "adapter", adapter: extendedAdapter },
      workspace: { cwd: "/workspace" },
      extensions: { sessionAccess },
    });
    await extendedController.connect();
    await extendedController.selectSession("s1");
    expect(sessionAccess).toHaveBeenCalledWith({
      method: "load",
      response: { _meta: metadata },
    });
    expect(extendedController.getState().sessions.s1?.access).toEqual({
      mode: "read-only",
      reason: "active elsewhere",
    });
  });

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
    expect(session.messages.filter((message) => message.role === "user")).toHaveLength(2);
    expect(session.messages.at(-2)).toMatchObject({ role: "user", optimistic: false });
    expect(session.messages.find((message) => message.id === "agent-answer")?.status).toEqual({
      type: "complete",
      stopReason: "end_turn",
    });
    expect(adapter.connection.prompt).toHaveBeenCalledWith({
      sessionId: "s1",
      prompt: [{ type: "text", text: "hello" }],
    });
  });

  it("将正文和附件图片一起发送到 ACP prompt", async () => {
    const adapter = new ConformanceAdapter();
    const controller = new AcpThreadController({
      connection: { type: "adapter", adapter },
      workspace: { cwd: "/workspace" },
    });
    await controller.connect();
    await controller.selectSession("s1");

    await controller.sendMessage({
      role: "user",
      content: [{ type: "text", text: "describe this image" }],
      attachments: [
        {
          id: "clipboard-image",
          type: "image",
          name: "clipboard.png",
          content: [{ type: "image", image: "data:image/png;base64,YQ==" }],
        },
      ],
    } as unknown as AppendMessage);

    expect(adapter.connection.prompt).toHaveBeenCalledWith({
      sessionId: "s1",
      prompt: [
        { type: "text", text: "describe this image" },
        { type: "image", mimeType: "image/png", data: "YQ==" },
      ],
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
    adapter.connection.authenticationStatus = vi.fn(async () => ({ type: "unauthenticated" }));
    await controller.connect();
    expect(controller.getState().connectionStatus).toBe("auth-required");
    await controller.authenticate("login");
    expect(adapter.connection.authenticate).toHaveBeenCalledWith("login");
    expect(controller.getState().connectionStatus).toBe("ready");
    await controller.logout();
    expect(controller.getState().connectionStatus).toBe("auth-required");
  });

  it("已有认证状态时跳过登录门控", async () => {
    const adapter = new ConformanceAdapter();
    adapter.connection.initialize = vi.fn(async () => ({
      protocolVersion: PROTOCOL_VERSION,
      agentCapabilities: { sessionCapabilities: { list: {} } },
      authMethods: [
        { id: "api-key", name: "API Key" },
        { id: "chat-gpt", name: "ChatGPT" },
      ],
    }));
    adapter.connection.authenticationStatus = vi.fn(async () => ({
      type: "chat-gpt",
      email: "user@example.com",
    }));
    const controller = new AcpThreadController({
      connection: { type: "adapter", adapter },
      workspace: { cwd: "/workspace" },
    });

    await controller.connect();

    expect(adapter.connection.authenticationStatus).toHaveBeenCalledOnce();
    expect(adapter.connection.authenticate).not.toHaveBeenCalled();
    expect(controller.getState().connectionStatus).toBe("ready");
    expect(adapter.connection.listSessions).toHaveBeenCalled();
  });

  it("认证状态明确为 unauthenticated 时显示登录门控", async () => {
    const adapter = new ConformanceAdapter();
    adapter.connection.initialize = vi.fn(async () => ({
      protocolVersion: PROTOCOL_VERSION,
      authMethods: [{ id: "chat-gpt", name: "ChatGPT" }],
    }));
    adapter.connection.authenticationStatus = vi.fn(async () => ({ type: "unauthenticated" }));
    const controller = new AcpThreadController({
      connection: { type: "adapter", adapter },
      workspace: { cwd: "/workspace" },
    });

    await controller.connect();

    expect(controller.getState().connectionStatus).toBe("auth-required");
  });

  it("认证状态扩展不可用时先继续，并在 Agent 返回 auth_required 后门控", async () => {
    const adapter = new ConformanceAdapter();
    adapter.connection.initialize = vi.fn(async () => ({
      protocolVersion: PROTOCOL_VERSION,
      authMethods: [{ id: "opencode-login", name: "Login with opencode" }],
    }));
    adapter.connection.newSession = vi.fn(async () => {
      throw RequestError.authRequired();
    });
    const controller = new AcpThreadController({
      connection: { type: "adapter", adapter },
      workspace: { cwd: "/workspace" },
    });

    await controller.connect();
    expect(controller.getState().connectionStatus).toBe("ready");

    await expect(
      controller.sendMessage({
        role: "user",
        content: [{ type: "text", text: "hello" }],
      } as unknown as AppendMessage),
    ).rejects.toMatchObject({ code: -32000 });
    expect(controller.getState().connectionStatus).toBe("auth-required");
    expect(adapter.connection.newSession).toHaveBeenCalledOnce();

    await controller.authenticate("opencode-login");
    expect(controller.getState().connectionStatus).toBe("ready");
    expect(adapter.connection.newSession).toHaveBeenCalledOnce();
  });

  it("重连后重新查询并保持已有认证状态", async () => {
    const adapter = new ReconnectingAdapter();
    adapter.authStatus = { type: "chat-gpt" };
    const controller = new AcpThreadController({
      connection: { type: "adapter", adapter },
      workspace: { cwd: "/workspace" },
    });

    await controller.connect();
    expect(controller.getState().connectionStatus).toBe("ready");
    await controller.reconnect();

    expect(controller.getState().connectionStatus).toBe("ready");
    expect(adapter.connections).toHaveLength(2);
    expect(adapter.connections[0]!.authenticationStatus).toHaveBeenCalledOnce();
    expect(adapter.connections[1]!.authenticationStatus).toHaveBeenCalledOnce();
  });

  it("重连后强制 load 当前 session，并忽略旧连接通知", async () => {
    const adapter = new ReconnectingAdapter();
    const controller = new AcpThreadController({
      connection: { type: "adapter", adapter },
      workspace: { cwd: "/workspace" },
    });
    await controller.connect();
    await controller.selectSession("s1");
    expect(adapter.loads).toEqual(["0:s1"]);

    await controller.reconnect();
    expect(adapter.loads).toEqual(["0:s1", "1:s1"]);
    expect(controller.getState().sessions.s1?.messages[0]?.id).toBe("history-1");

    await adapter.handlers[0]!.sessionUpdate({
      sessionId: "s1",
      update: {
        sessionUpdate: "agent_message_chunk",
        messageId: "stale",
        content: { type: "text", text: "stale" },
      },
    });
    expect(
      controller.getState().sessions.s1?.messages.some((message) => message.id === "stale"),
    ).toBe(false);
  });

  it("重连后没有 load/resume 能力时保留缓存并禁止 prompt", async () => {
    const adapter = new ReconnectingAdapter();
    const controller = new AcpThreadController({
      connection: { type: "adapter", adapter },
      workspace: { cwd: "/workspace" },
    });
    await controller.connect();
    await controller.selectSession("s1");
    adapter.supportsLoad = false;

    await controller.reconnect();
    expect(controller.getState().sessions.s1?.messages[0]?.id).toBe("history-0");
    expect(controller.getState().sessions.s1?.runState).toBe("error");
    await expect(
      controller.prompt("s1", [{ type: "text", text: "blocked" }]),
    ).rejects.toMatchObject({
      code: "ACP_SESSION_NOT_ATTACHED",
    });
  });

  it("快速切换只允许最新 session 生效，同时保留较晚完成的历史", async () => {
    const adapter = new ConformanceAdapter();
    const loads = new Map<string, ReturnType<typeof deferred<void>>>();
    adapter.connection.loadSession = vi.fn(async ({ sessionId }: { sessionId: string }) => {
      const gate = deferred<void>();
      loads.set(sessionId, gate);
      await gate.promise;
      await adapter.handlers?.sessionUpdate({
        sessionId,
        update: {
          sessionUpdate: "user_message_chunk",
          messageId: `history-${sessionId}`,
          content: { type: "text", text: sessionId },
        },
      });
      return {};
    });
    const controller = new AcpThreadController({
      connection: { type: "adapter", adapter },
      workspace: { cwd: "/workspace" },
    });
    await controller.connect();

    const selectA = controller.selectSession("s1");
    const selectB = controller.selectSession("s2");
    loads.get("s2")!.resolve();
    await selectB;
    loads.get("s1")!.resolve();
    await selectA;

    expect(controller.getState().activeSessionId).toBe("s2");
    expect(controller.getState().sessions.s1?.messages[0]?.id).toBe("history-s1");
    expect(controller.getState().sessions.s2?.messages[0]?.id).toBe("history-s2");
  });

  it("load 失败恢复快照和原 active session，并允许重试", async () => {
    const adapter = new ConformanceAdapter();
    const controller = new AcpThreadController({
      connection: { type: "adapter", adapter },
      workspace: { cwd: "/workspace" },
    });
    await controller.connect();
    await controller.createSession();
    adapter.connection.loadSession = vi.fn(async () => {
      throw new Error("load failed");
    });

    await expect(controller.selectSession("s1")).rejects.toThrow("load failed");
    expect(controller.getState().activeSessionId).toBe("new-session");
    expect(controller.getState().sessions.s1?.info?.title).toBe("One");

    adapter.connection.loadSession = vi.fn(async ({ sessionId }: { sessionId: string }) => {
      await adapter.handlers?.sessionUpdate({
        sessionId,
        update: {
          sessionUpdate: "user_message_chunk",
          content: { type: "text", text: "retried" },
        },
      });
      return {};
    });
    await controller.selectSession("s1");
    expect(controller.getState().activeSessionId).toBe("s1");
    expect(controller.getState().sessions.s1?.messages[0]?.pieces[0]).toMatchObject({
      type: "content",
      content: { type: "text", text: "retried" },
    });
  });

  it("合并分块 user echo，保留本地 ID 和协议 ID", async () => {
    const adapter = new ConformanceAdapter();
    adapter.connection.prompt = vi.fn(async ({ sessionId }: { sessionId: string }) => {
      for (const text of ["hel", "lo"]) {
        await adapter.handlers?.sessionUpdate({
          sessionId,
          update: {
            sessionUpdate: "user_message_chunk",
            messageId: "protocol-user",
            content: { type: "text", text },
            _meta: { echoed: true },
          },
          _meta: { envelope: text },
        });
      }
      await adapter.handlers?.sessionUpdate({
        sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "answer" },
        },
      });
      return { stopReason: "end_turn" as const };
    });
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

    const userMessages = controller
      .getState()
      .sessions.s1!.messages.filter((message) => message.role === "user");
    expect(userMessages).toHaveLength(2);
    expect(userMessages[1]?.id).toMatch(/^local:/);
    expect(userMessages[1]).toMatchObject({
      protocolMessageId: "protocol-user",
      optimistic: false,
    });
    expect(userMessages[1]?.rawNotifications).toHaveLength(2);
  });

  it("不合并内容不同的协议用户消息", async () => {
    const adapter = new ConformanceAdapter();
    adapter.connection.prompt = vi.fn(async ({ sessionId }: { sessionId: string }) => {
      await adapter.handlers?.sessionUpdate({
        sessionId,
        update: {
          sessionUpdate: "user_message_chunk",
          messageId: "different-user",
          content: { type: "text", text: "different" },
        },
      });
      return { stopReason: "end_turn" as const };
    });
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

    const users = controller
      .getState()
      .sessions.s1!.messages.filter((message) => message.role === "user");
    expect(users).toHaveLength(3);
    expect(users.at(-1)?.protocolMessageId).toBe("different-user");
  });

  it("prompt 传输失败后 turn 回到 idle 并保留可重试用户消息", async () => {
    const adapter = new ConformanceAdapter();
    adapter.connection.prompt = vi.fn(async () => {
      throw new Error("transport failed");
    });
    const controller = new AcpThreadController({
      connection: { type: "adapter", adapter },
      workspace: { cwd: "/workspace" },
    });
    await controller.connect();
    await controller.selectSession("s1");

    await expect(
      controller.sendMessage({
        role: "user",
        content: [{ type: "text", text: "retry me" }],
      } as unknown as AppendMessage),
    ).rejects.toThrow("transport failed");

    const session = controller.getState().sessions.s1!;
    expect(session.runState).toBe("idle");
    expect(session.error).toEqual(new Error("transport failed"));
    expect(session.messages.at(-1)).toMatchObject({
      role: "user",
      optimistic: false,
      error: new Error("transport failed"),
    });
  });

  it("close 取消未决权限并清空 active，resume 通知受控 thread", async () => {
    const adapter = new ConformanceAdapter();
    const onThreadIdChange = vi.fn();
    const controller = new AcpThreadController({
      connection: { type: "adapter", adapter },
      workspace: { cwd: "/workspace" },
      onThreadIdChange,
    });
    await controller.connect();
    await controller.resumeSession("s1");
    expect(onThreadIdChange).toHaveBeenLastCalledWith("s1");
    const pending = adapter.handlers!.requestPermission(
      {
        sessionId: "s1",
        toolCall: { toolCallId: "pending-close", title: "Wait" },
        options: [{ optionId: "no", name: "Reject", kind: "reject_once" }],
      },
      new AbortController().signal,
    );

    await controller.closeSession("s1");
    await expect(pending).resolves.toEqual({ outcome: { outcome: "cancelled" } });
    expect(controller.getState().activeSessionId).toBeUndefined();
    expect(controller.getState().sessions.s1).toBeDefined();
    expect(onThreadIdChange).toHaveBeenLastCalledWith(undefined);
  });

  it("refreshSessions 对账非 active session 并保留 active", async () => {
    const adapter = new ConformanceAdapter();
    const controller = new AcpThreadController({
      connection: { type: "adapter", adapter },
      workspace: { cwd: "/workspace" },
    });
    await controller.connect();
    await controller.createSession();
    adapter.connection.listSessions = vi.fn(async () => ({
      sessions: [
        { sessionId: "s2", cwd: "/workspace", title: "Two updated" },
        { sessionId: "s3", cwd: "/workspace", title: "Three" },
      ],
    }));

    await controller.refreshSessions();
    expect(controller.getState().sessionOrder).toEqual(["s2", "s3", "new-session"]);
    expect(controller.getState().sessions.s1).toBeUndefined();
    expect(controller.getState().sessions.s2?.info?.title).toBe("Two updated");
    expect(controller.getState().sessions["new-session"]).toBeDefined();
  });
});

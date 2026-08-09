import { PROTOCOL_VERSION, agent, methods, ndJsonStream } from "@agentclientprotocol/sdk";
import type { AppendMessage } from "@assistant-ui/react";
import { describe, expect, it, vi } from "vitest";
import { AcpThreadController } from "../src/core/controller";

describe("in-process ACP Agent conformance", () => {
  it("通过认证状态扩展识别已有登录态", async () => {
    const clientToAgent = new TransformStream<Uint8Array, Uint8Array>();
    const agentToClient = new TransformStream<Uint8Array, Uint8Array>();
    const status = vi.fn(() => ({ type: "chat-gpt", email: "user@example.com" }));
    const agentConnection = agent({ name: "authenticated-fixture" })
      .onRequest(methods.agent.initialize, ({ params }) => ({
        protocolVersion: params.protocolVersion,
        agentCapabilities: {},
        authMethods: [
          { id: "api-key", name: "API Key" },
          { id: "chat-gpt", name: "ChatGPT" },
        ],
      }))
      .onRequest("authentication/status", () => ({}), status)
      .connect(ndJsonStream(agentToClient.writable, clientToAgent.readable));
    const controller = new AcpThreadController({
      connection: {
        type: "stream",
        createStream: () => ndJsonStream(clientToAgent.writable, agentToClient.readable),
      },
      workspace: { cwd: "/workspace" },
    });

    await controller.connect();

    expect(status).toHaveBeenCalledOnce();
    expect(controller.getState().connectionStatus).toBe("ready");
    controller.dispose();
    agentConnection.close();
  });

  it("认证状态扩展不可用时不把认证能力误判为未登录", async () => {
    const clientToAgent = new TransformStream<Uint8Array, Uint8Array>();
    const agentToClient = new TransformStream<Uint8Array, Uint8Array>();
    const agentConnection = agent({ name: "legacy-auth-fixture" })
      .onRequest(methods.agent.initialize, ({ params }) => ({
        protocolVersion: params.protocolVersion,
        agentCapabilities: {},
        authMethods: [{ id: "login", name: "Login" }],
      }))
      .connect(ndJsonStream(agentToClient.writable, clientToAgent.readable));
    const controller = new AcpThreadController({
      connection: {
        type: "stream",
        createStream: () => ndJsonStream(clientToAgent.writable, agentToClient.readable),
      },
      workspace: { cwd: "/workspace" },
    });

    await controller.connect();

    expect(controller.getState().connectionStatus).toBe("ready");
    controller.dispose();
    agentConnection.close();
  });

  it("通过官方 Stream SDK 完成 initialize、Client 服务、权限和消息流", async () => {
    const clientToAgent = new TransformStream<Uint8Array, Uint8Array>();
    const agentToClient = new TransformStream<Uint8Array, Uint8Array>();

    const agentConnection = agent({ name: "in-process-fixture" })
      .onRequest(methods.agent.initialize, ({ params }) => ({
        protocolVersion: params.protocolVersion,
        agentCapabilities: {},
      }))
      .onRequest(methods.agent.session.new, () => ({ sessionId: "stream-s1" }))
      .onRequest(methods.agent.session.prompt, async (context) => {
        const file = await context.client.request(methods.client.fs.readTextFile, {
          sessionId: context.params.sessionId,
          path: "/workspace/input.txt",
        });
        await context.client.request(methods.client.fs.writeTextFile, {
          sessionId: context.params.sessionId,
          path: "/workspace/output.txt",
          content: file.content,
        });
        const terminal = await context.client.request(methods.client.terminal.create, {
          sessionId: context.params.sessionId,
          command: "echo",
          args: ["ok"],
          cwd: "/workspace",
        });
        await context.client.request(methods.client.terminal.output, {
          sessionId: context.params.sessionId,
          terminalId: terminal.terminalId,
        });
        await context.client.request(methods.client.terminal.waitForExit, {
          sessionId: context.params.sessionId,
          terminalId: terminal.terminalId,
        });
        await context.client.request(methods.client.terminal.kill, {
          sessionId: context.params.sessionId,
          terminalId: terminal.terminalId,
        });
        await context.client.request(methods.client.terminal.release, {
          sessionId: context.params.sessionId,
          terminalId: terminal.terminalId,
        });
        const permission = await context.client.request(methods.client.session.requestPermission, {
          sessionId: context.params.sessionId,
          toolCall: {
            toolCallId: "stream-tool",
            title: "Write fixture",
            kind: "edit",
          },
          options: [{ optionId: "allow", name: "Allow", kind: "allow_once" }],
        });
        await context.client.notify(methods.client.session.update, {
          sessionId: context.params.sessionId,
          update: {
            sessionUpdate: "agent_message_chunk",
            messageId: "stream-answer",
            content: {
              type: "text",
              text: `${file.content}:${permission.outcome.outcome}`,
            },
          },
        });
        return { stopReason: "end_turn" };
      })
      .onNotification(methods.agent.session.cancel, () => {})
      .connect(ndJsonStream(agentToClient.writable, clientToAgent.readable));

    const services = {
      fileSystem: {
        readTextFile: vi.fn(async () => ({ content: "fixture" })),
        writeTextFile: vi.fn(async () => {}),
      },
      terminal: {
        create: vi.fn(async () => ({ terminalId: "term-1" })),
        output: vi.fn(async () => ({ output: "ok\n", truncated: false })),
        waitForExit: vi.fn(async () => ({ exitCode: 0 })),
        kill: vi.fn(async () => {}),
        release: vi.fn(async () => {}),
      },
    };
    const controller = new AcpThreadController({
      connection: {
        type: "stream",
        createStream: () => ndJsonStream(clientToAgent.writable, agentToClient.readable),
      },
      workspace: { cwd: "/workspace" },
      clientServices: services,
    });

    await controller.connect();
    expect(controller.getState().initializeResponse?.protocolVersion).toBe(PROTOCOL_VERSION);
    const sending = controller.sendMessage({
      role: "user",
      content: [{ type: "text", text: "go" }],
    } as unknown as AppendMessage);
    await vi.waitFor(() => {
      expect(controller.getState().sessions["stream-s1"]?.permissions["stream-tool"]?.status).toBe(
        "pending",
      );
    });
    await controller.replyToPermission("stream-s1", "stream-tool", "allow");
    await sending;

    expect(services.fileSystem.readTextFile).toHaveBeenCalled();
    expect(services.fileSystem.writeTextFile).toHaveBeenCalled();
    expect(services.terminal.create).toHaveBeenCalled();
    expect(services.terminal.release).toHaveBeenCalled();
    const session = controller.getState().sessions["stream-s1"]!;
    expect(session.messages.find((message) => message.id === "stream-answer")).toMatchObject({
      status: { type: "complete", stopReason: "end_turn" },
    });

    controller.dispose();
    agentConnection.close();
  });
});

import { PROTOCOL_VERSION } from "@agentclientprotocol/sdk";
import type {
  AcpAdapterConnectOptions,
  AcpClientAdapter,
  AcpClientConnection,
} from "react-acp/core";

export class MockAcpAdapter implements AcpClientAdapter {
  private sequence = 2;
  private handlers?: AcpAdapterConnectOptions["handlers"];

  async connect(options: AcpAdapterConnectOptions): Promise<AcpClientConnection> {
    this.handlers = options.handlers;
    const lifecycle = new AbortController();
    options.signal.addEventListener("abort", () => lifecycle.abort(), { once: true });

    return {
      signal: lifecycle.signal,
      initialize: async () => ({
        protocolVersion: PROTOCOL_VERSION,
        agentInfo: { name: "react-acp mock", version: "0.1.0" },
        agentCapabilities: {
          loadSession: true,
          sessionCapabilities: { list: {}, delete: {}, resume: {}, close: {} },
        },
      }),
      authenticate: async () => {},
      logout: async () => ({}),
      listSessions: async () => ({
        sessions: [
          { sessionId: "demo-1", cwd: "/mock", title: "First session" },
          { sessionId: "demo-2", cwd: "/mock", title: "Second session" },
        ],
      }),
      newSession: async () => ({ sessionId: `demo-${++this.sequence}` }),
      loadSession: async ({ sessionId }) => {
        await this.handlers?.sessionUpdate({
          sessionId,
          update: {
            sessionUpdate: "agent_message_chunk",
            messageId: `${sessionId}-welcome`,
            content: { type: "text", text: `Loaded ${sessionId}` },
          },
        });
        return {
          modes: {
            currentModeId: "code",
            availableModes: [
              { id: "code", name: "Code" },
              { id: "ask", name: "Ask" },
            ],
          },
          configOptions: [
            {
              type: "boolean",
              id: "safe-mode",
              name: "Safe mode",
              category: "mode",
              currentValue: true,
            },
          ],
        };
      },
      resumeSession: async () => ({}),
      deleteSession: async () => ({}),
      closeSession: async () => {},
      setSessionMode: async ({ sessionId, modeId }) => {
        await this.handlers?.sessionUpdate({
          sessionId,
          update: { sessionUpdate: "current_mode_update", currentModeId: modeId },
        });
      },
      setSessionConfigOption: async ({ configId, value }) => {
        return {
          configOptions: [
            {
              type: "boolean",
              id: configId,
              name: "Safe mode",
              category: "mode",
              currentValue: Boolean(value),
            },
          ],
        };
      },
      prompt: async ({ sessionId }) => {
        await this.handlers?.sessionUpdate({
          sessionId,
          update: {
            sessionUpdate: "plan",
            entries: [
              { content: "Read request", priority: "high", status: "completed" },
              { content: "Respond", priority: "medium", status: "in_progress" },
            ],
          },
        });
        await this.handlers?.sessionUpdate({
          sessionId,
          update: {
            sessionUpdate: "tool_call",
            toolCallId: `tool-${Date.now()}`,
            title: "Inspect workspace",
            kind: "read",
            status: "completed",
            rawInput: { cwd: "/mock" },
            rawOutput: { files: 3 },
          },
        });
        await this.handlers?.sessionUpdate({
          sessionId,
          update: {
            sessionUpdate: "agent_message_chunk",
            messageId: `answer-${Date.now()}`,
            content: { type: "text", text: "Mock ACP agent completed the turn." },
          },
        });
        return { stopReason: "end_turn" };
      },
      cancel: async () => {},
      close: () => lifecycle.abort(),
    };
  }
}

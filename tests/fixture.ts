import { PROTOCOL_VERSION } from "@agentclientprotocol/sdk";
import { vi } from "vitest";
import type {
  AcpAdapterConnectOptions,
  AcpClientAdapter,
  AcpClientConnection,
} from "../src/core/types";

export class ConformanceAdapter implements AcpClientAdapter {
  readonly abortController = new AbortController();
  handlers?: AcpAdapterConnectOptions["handlers"];
  listPage = 0;

  readonly connection: AcpClientConnection = {
    signal: this.abortController.signal,
    initialize: vi.fn(async () => ({
      protocolVersion: PROTOCOL_VERSION,
      agentCapabilities: {
        loadSession: true,
        promptCapabilities: { image: true, audio: true, embeddedContext: true },
        sessionCapabilities: {
          list: {},
          delete: {},
          resume: {},
          close: {},
          additionalDirectories: {},
        },
        auth: { logout: {} },
      },
      agentInfo: { name: "fixture-agent", version: "1.0.0" },
    })),
    authenticate: vi.fn(async () => {}),
    logout: vi.fn(async () => ({})),
    newSession: vi.fn(async () => ({
      sessionId: "new-session",
      modes: {
        currentModeId: "ask",
        availableModes: [{ id: "ask", name: "Ask" }],
      },
      configOptions: [
        {
          type: "boolean" as const,
          id: "safe",
          name: "safe",
          category: "mode",
          currentValue: false,
        },
      ],
    })),
    loadSession: vi.fn<AcpClientConnection["loadSession"]>(async ({ sessionId }) => {
      await this.handlers?.sessionUpdate({
        sessionId,
        update: {
          sessionUpdate: "user_message_chunk",
          messageId: "history-user",
          content: { type: "text", text: "history" },
        },
      });
      return {};
    }),
    listSessions: vi.fn(async () => {
      this.listPage += 1;
      return this.listPage === 1
        ? {
            sessions: [{ sessionId: "s1", cwd: "/workspace", title: "One" }],
            nextCursor: "next",
          }
        : { sessions: [{ sessionId: "s2", cwd: "/workspace", title: "Two" }] };
    }),
    deleteSession: vi.fn(async () => ({})),
    resumeSession: vi.fn(async () => ({})),
    closeSession: vi.fn(async () => {}),
    setSessionMode: vi.fn(async () => {}),
    setSessionConfigOption: vi.fn<AcpClientConnection["setSessionConfigOption"]>(
      async ({ configId, value }) => ({
        configOptions: [
          {
            type: "boolean" as const,
            id: configId,
            name: configId,
            category: "mode",
            currentValue: Boolean(value),
          },
        ],
      }),
    ),
    prompt: vi.fn<AcpClientConnection["prompt"]>(async ({ sessionId }) => {
      await this.handlers?.sessionUpdate({
        sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          messageId: "agent-answer",
          content: { type: "text", text: "fixture answer" },
        },
      });
      return { stopReason: "end_turn" as const };
    }),
    cancel: vi.fn(async () => {}),
    close: vi.fn(() => this.abortController.abort()),
  };

  async connect(options: AcpAdapterConnectOptions) {
    this.handlers = options.handlers;
    return this.connection;
  }
}

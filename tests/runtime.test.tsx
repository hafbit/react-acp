import { PROTOCOL_VERSION } from "@agentclientprotocol/sdk";
import { AssistantRuntimeProvider } from "@assistant-ui/react";
import { render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { describe, expect, it, vi } from "vitest";
import { useAcpConnection, useAcpRuntime } from "../src";
import type { AcpAdapterConnectOptions, AcpClientAdapter, AcpClientConnection } from "../src/core";

const connectionFor = (signal: AbortSignal, close: () => void): AcpClientConnection => ({
  signal,
  initialize: async () => ({ protocolVersion: PROTOCOL_VERSION }),
  authenticate: async () => {},
  logout: async () => ({}),
  newSession: async () => ({ sessionId: "s1" }),
  loadSession: async () => ({}),
  listSessions: async () => ({ sessions: [] }),
  deleteSession: async () => ({}),
  resumeSession: async () => ({}),
  closeSession: async () => {},
  setSessionMode: async () => {},
  setSessionConfigOption: async () => ({ configOptions: [] }),
  prompt: async () => ({ stopReason: "end_turn" }),
  cancel: async () => {},
  close,
});

describe("useAcpRuntime", () => {
  it("React StrictMode 重建连接并在卸载时释放资源", async () => {
    const closes: Array<ReturnType<typeof vi.fn>> = [];
    const adapter: AcpClientAdapter = {
      connect: vi.fn(async ({ signal }: AcpAdapterConnectOptions) => {
        const lifecycle = new AbortController();
        const close = vi.fn(() => lifecycle.abort());
        closes.push(close);
        signal.addEventListener("abort", close, { once: true });
        return connectionFor(lifecycle.signal, close);
      }),
    };

    function Probe() {
      const connection = useAcpConnection();
      return <output data-testid="status">{connection.status}</output>;
    }

    function Runtime() {
      const runtime = useAcpRuntime({
        connection: { type: "adapter", adapter },
        workspace: { cwd: "/workspace" },
      });
      return (
        <AssistantRuntimeProvider runtime={runtime}>
          <Probe />
        </AssistantRuntimeProvider>
      );
    }

    const view = render(
      <StrictMode>
        <Runtime />
      </StrictMode>,
    );
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("ready"));
    expect(adapter.connect).toHaveBeenCalledTimes(2);
    expect(closes[0]).toHaveBeenCalled();

    view.unmount();
    expect(closes.at(-1)).toHaveBeenCalled();
  });
});

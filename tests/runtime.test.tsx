import { PROTOCOL_VERSION } from "@agentclientprotocol/sdk";
import { AssistantRuntimeProvider } from "@assistant-ui/react";
import { render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { describe, expect, it, vi } from "vitest";
import { useAcpConnection, useAcpRuntime, useAcpRuntimeExtras } from "../src";
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

  it("运行时使用最新回调而无需重建 identity 配置", async () => {
    const lifecycle = new AbortController();
    const adapter: AcpClientAdapter = {
      connect: vi.fn(async () => connectionFor(lifecycle.signal, () => lifecycle.abort())),
    };
    const first = vi.fn();
    const latest = vi.fn();

    function Probe() {
      const extras = useAcpRuntimeExtras();
      const connection = useAcpConnection();
      return (
        <>
          <output data-testid="callback-status">{connection.status}</output>
          <button onClick={() => void extras.createSession()}>Create</button>
        </>
      );
    }

    function Runtime({ onChange }: { onChange: (id?: string) => void }) {
      const runtime = useAcpRuntime({
        connection: { type: "adapter", adapter },
        workspace: { cwd: "/workspace" },
        onThreadIdChange: onChange,
      });
      return (
        <AssistantRuntimeProvider runtime={runtime}>
          <Probe />
        </AssistantRuntimeProvider>
      );
    }

    const view = render(<Runtime onChange={first} />);
    view.rerender(<Runtime onChange={latest} />);
    await waitFor(() => expect(screen.getByTestId("callback-status").textContent).toBe("ready"));
    screen.getByRole("button", { name: "Create" }).click();
    await waitFor(() => expect(latest).toHaveBeenCalledWith("s1"));
    expect(first).not.toHaveBeenCalled();
  });

  it("受控 threadId 同步不回显 onThreadIdChange", async () => {
    const lifecycle = new AbortController();
    const loadSession = vi.fn(async () => ({}));
    const adapter: AcpClientAdapter = {
      connect: vi.fn(async () => ({
        ...connectionFor(lifecycle.signal, () => lifecycle.abort()),
        initialize: async () => ({
          protocolVersion: PROTOCOL_VERSION,
          agentCapabilities: { loadSession: true },
        }),
        loadSession,
      })),
    };
    const onThreadIdChange = vi.fn();

    function Runtime() {
      const runtime = useAcpRuntime({
        connection: { type: "adapter", adapter },
        workspace: { cwd: "/workspace" },
        threadId: "s1",
        onThreadIdChange,
      });
      return <AssistantRuntimeProvider runtime={runtime}>{null}</AssistantRuntimeProvider>;
    }

    render(<Runtime />);
    await waitFor(() =>
      expect(loadSession).toHaveBeenCalledWith(expect.objectContaining({ sessionId: "s1" })),
    );
    expect(onThreadIdChange).not.toHaveBeenCalled();
  });

  it("identity 配置变化时通过 React key 重建 controller", async () => {
    const connectA = vi.fn();
    const connectB = vi.fn();
    const makeAdapter = (connect: ReturnType<typeof vi.fn>): AcpClientAdapter => ({
      connect: async () => {
        connect();
        const lifecycle = new AbortController();
        return connectionFor(lifecycle.signal, () => lifecycle.abort());
      },
    });
    const adapterA = makeAdapter(connectA);
    const adapterB = makeAdapter(connectB);

    function Runtime({ adapter }: { adapter: AcpClientAdapter }) {
      const runtime = useAcpRuntime({
        connection: { type: "adapter", adapter },
        workspace: { cwd: "/workspace" },
      });
      return <AssistantRuntimeProvider runtime={runtime}>{null}</AssistantRuntimeProvider>;
    }

    const view = render(<Runtime key="agent-a:/workspace" adapter={adapterA} />);
    await waitFor(() => expect(connectA).toHaveBeenCalledTimes(1));
    view.rerender(<Runtime key="agent-b:/workspace" adapter={adapterB} />);
    await waitFor(() => expect(connectB).toHaveBeenCalledTimes(1));
  });
});

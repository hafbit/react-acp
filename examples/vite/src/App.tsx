import { AssistantRuntimeProvider, ComposerPrimitive, ThreadPrimitive } from "@assistant-ui/react";
import { useMemo, useState } from "react";
import {
  AcpConfigOptions,
  AcpModeSelect,
  AcpPlan,
  useAcpConnection,
  useAcpRuntime,
  useAcpRuntimeExtras,
} from "@hafbit/react-acp";
import { MockAcpAdapter } from "./mock-adapter";
import "./style.css";

function SessionList() {
  const extras = useAcpRuntimeExtras();
  return (
    <aside>
      <button onClick={() => void extras.createSession()}>New session</button>
      {extras.state.sessionOrder.map((id) => (
        <button
          key={id}
          data-active={id === extras.state.activeSessionId}
          onClick={() => void extras.selectSession(id)}
        >
          {extras.state.sessions[id]?.info?.title ?? id}
        </button>
      ))}
    </aside>
  );
}

function ConnectionStatus() {
  const connection = useAcpConnection();
  return <output data-testid="connection">{connection.status}</output>;
}

function Workbench() {
  return (
    <main>
      <SessionList />
      <section>
        <header>
          <ConnectionStatus />
          <AcpModeSelect aria-label="Mode" />
          <AcpConfigOptions />
        </header>
        <AcpPlan />
        <ThreadPrimitive.Root>
          <ThreadPrimitive.Viewport>
            <ThreadPrimitive.Messages>
              {({ message }) => (
                <article data-role={message.role}>
                  {message.content.map((part, index) => (
                    <pre key={index}>{JSON.stringify(part, null, 2)}</pre>
                  ))}
                </article>
              )}
            </ThreadPrimitive.Messages>
            <ComposerPrimitive.Root>
              <ComposerPrimitive.Input aria-label="Message" placeholder="Ask the mock ACP agent" />
              <ComposerPrimitive.Send>Send</ComposerPrimitive.Send>
            </ComposerPrimitive.Root>
          </ThreadPrimitive.Viewport>
        </ThreadPrimitive.Root>
      </section>
    </main>
  );
}

export function App() {
  const adapter = useMemo(() => new MockAcpAdapter(), []);
  const [threadId, setThreadId] = useState<string | undefined>("demo-1");
  const runtime = useAcpRuntime({
    connection: { type: "adapter", adapter },
    workspace: { cwd: "/mock" },
    threadId,
    onThreadIdChange: setThreadId,
  });
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <Workbench />
    </AssistantRuntimeProvider>
  );
}

import {
  client,
  methods,
  type ClientConnection,
  type KillTerminalRequest,
} from "@agentclientprotocol/sdk";
import type {
  AcpClientAdapter,
  AcpClientConnection,
  AcpStreamFactory,
} from "./types";

export class SdkAcpClientAdapter implements AcpClientAdapter {
  constructor(
    private readonly createStream: AcpStreamFactory,
    private readonly name = "react-acp",
  ) {}

  async connect({ handlers, signal }: Parameters<AcpClientAdapter["connect"]>[0]) {
    let app = client({ name: this.name })
      .onNotification(methods.client.session.update, ({ params }) =>
        handlers.sessionUpdate(params),
      )
      .onRequest(
        methods.client.session.requestPermission,
        ({ params, signal: requestSignal }) =>
          handlers.requestPermission(params, requestSignal),
      );

    if (handlers.readTextFile) {
      app = app.onRequest(
        methods.client.fs.readTextFile,
        ({ params, signal: requestSignal }) =>
          handlers.readTextFile!(params, requestSignal),
      );
    }
    if (handlers.writeTextFile) {
      app = app.onRequest(
        methods.client.fs.writeTextFile,
        ({ params, signal: requestSignal }) =>
          handlers.writeTextFile!(params, requestSignal),
      );
    }
    if (handlers.terminal) {
      const terminal = handlers.terminal;
      app = app
        .onRequest(
          methods.client.terminal.create,
          ({ params, signal: requestSignal }) =>
            terminal.create(params, requestSignal),
        )
        .onRequest(
          methods.client.terminal.output,
          ({ params, signal: requestSignal }) =>
            terminal.output(params, requestSignal),
        )
        .onRequest(
          methods.client.terminal.release,
          ({ params, signal: requestSignal }) =>
            terminal.release(params, requestSignal),
        )
        .onRequest(
          methods.client.terminal.waitForExit,
          ({ params, signal: requestSignal }) =>
            terminal.waitForExit(params, requestSignal),
        )
        .onRequest(
          methods.client.terminal.kill,
          ({ params, signal: requestSignal }) =>
            terminal.kill(params as KillTerminalRequest, requestSignal),
        );
    }

    const stream = await this.createStream({ signal });
    const connection = app.connect(stream);
    const close = () => connection.close(signal.reason);
    if (signal.aborted) close();
    else signal.addEventListener("abort", close, { once: true });

    return createConnectionFacade(connection, () =>
      signal.removeEventListener("abort", close),
    );
  }
}

const createConnectionFacade = (
  connection: ClientConnection,
  cleanup: () => void,
): AcpClientConnection => ({
  signal: connection.signal,
  initialize: (request) =>
    connection.agent.request(methods.agent.initialize, request),
  authenticate: async (methodId) => {
    await connection.agent.request(methods.agent.authenticate, { methodId });
  },
  logout: () => connection.agent.request(methods.agent.logout, {}),
  newSession: (request) =>
    connection.agent.request(methods.agent.session.new, request),
  loadSession: (request) =>
    connection.agent.request(methods.agent.session.load, request),
  listSessions: (request) =>
    connection.agent.request(methods.agent.session.list, request),
  deleteSession: (sessionId) =>
    connection.agent.request(methods.agent.session.delete, { sessionId }),
  resumeSession: (request) =>
    connection.agent.request(methods.agent.session.resume, request),
  closeSession: async (sessionId) => {
    await connection.agent.request(methods.agent.session.close, { sessionId });
  },
  setSessionMode: async (request) => {
    await connection.agent.request(methods.agent.session.setMode, request);
  },
  setSessionConfigOption: (request) =>
    connection.agent.request(methods.agent.session.setConfigOption, request),
  prompt: (request) =>
    connection.agent.request(methods.agent.session.prompt, request),
  cancel: (sessionId) =>
    connection.agent.notify(methods.agent.session.cancel, { sessionId }),
  close: (error) => {
    cleanup();
    connection.close(error);
  },
});

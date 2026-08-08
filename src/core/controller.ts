import {
  PROTOCOL_VERSION,
  type ContentBlock,
  type PromptResponse,
  type RequestPermissionResponse,
  type SetSessionConfigOptionRequest,
  type SessionInfo,
} from "@agentclientprotocol/sdk";
import type { AppendMessage } from "@assistant-ui/react";
import { AcpCapabilityError, AcpError } from "./errors";
import { SdkAcpClientAdapter } from "./sdk-adapter";
import {
  createAcpThreadState,
  hasAgentCapability,
  reduceAcpThreadState,
} from "./state";
import {
  buildClientCapabilities,
  buildSessionRequest,
  hasCompleteTerminalServices,
  serializeAppendMessage,
  validateWorkspace,
} from "./serialize";
import type {
  AcpClientAdapter,
  AcpClientConnection,
  AcpRuntimeOptions,
  AcpStateEvent,
  AcpThreadState,
} from "./types";

type PermissionWaiter = {
  resolve(response: RequestPermissionResponse): void;
  reject(error: unknown): void;
};

export class AcpThreadController {
  private state = createAcpThreadState();
  private readonly listeners = new Set<() => void>();
  private connection?: AcpClientConnection;
  private abortController?: AbortController;
  private connectPromise?: Promise<void>;
  private readonly permissionWaiters = new Map<string, PermissionWaiter>();
  private disposed = false;

  constructor(private readonly options: AcpRuntimeOptions) {
    validateWorkspace(options.workspace);
  }

  getState = (): AcpThreadState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private dispatch(event: AcpStateEvent): void {
    this.state = reduceAcpThreadState(this.state, event);
    for (const listener of this.listeners) listener();
  }

  private reportError(error: unknown): void {
    this.options.onError?.(error);
  }

  private get adapter(): AcpClientAdapter {
    return this.options.connection.type === "adapter"
      ? this.options.connection.adapter
      : new SdkAcpClientAdapter(
          this.options.connection.createStream,
          this.options.clientInfo?.name ?? "react-acp",
        );
  }

  async connect(): Promise<void> {
    if (this.disposed) throw new AcpError("ACP_DISPOSED", "Controller disposed");
    if (this.connection && !this.connection.signal.aborted) return;
    if (this.connectPromise) {
      const pending = this.connectPromise;
      try {
        await pending;
      } catch {
        // A StrictMode cleanup can abort the first setup while it is connecting.
      }
      if (
        this.abortController?.signal.aborted ||
        !this.connection ||
        this.connection.signal.aborted
      ) {
        return this.connect();
      }
      return;
    }

    this.connectPromise = this.doConnect().finally(() => {
      this.connectPromise = undefined;
    });
    return this.connectPromise;
  }

  private async doConnect(): Promise<void> {
    this.abortController?.abort();
    const abortController = new AbortController();
    this.abortController = abortController;
    this.dispatch({ type: "connection.status", status: "connecting" });

    try {
      const services = this.options.clientServices;
      const connection = await this.adapter.connect({
        signal: abortController.signal,
        handlers: {
          sessionUpdate: (notification) => {
            this.dispatch({ type: "session.update", notification });
          },
          requestPermission: (request, signal) =>
            this.waitForPermission(request, signal),
          ...(services?.fileSystem?.readTextFile
            ? { readTextFile: services.fileSystem.readTextFile }
            : {}),
          ...(services?.fileSystem?.writeTextFile
            ? { writeTextFile: services.fileSystem.writeTextFile }
            : {}),
          ...(hasCompleteTerminalServices(services?.terminal)
            ? { terminal: services.terminal }
            : {}),
        },
      });
      this.connection = connection;
      connection.signal.addEventListener(
        "abort",
        () => {
          if (!this.disposed) {
            this.dispatch({ type: "connection.status", status: "closed" });
          }
        },
        { once: true },
      );

      const response = await connection.initialize({
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: buildClientCapabilities(
          services,
          this.options.clientCapabilities,
        ),
        clientInfo: this.options.clientInfo ?? {
          name: "react-acp",
          version: "0.1.0",
        },
      });
      if (abortController.signal.aborted) {
        connection.close(abortController.signal.reason);
        throw new AcpError("ACP_DISCONNECTED", "ACP connection was aborted.");
      }
      if (response.protocolVersion !== PROTOCOL_VERSION) {
        throw new AcpError(
          "ACP_PROTOCOL_VERSION",
          `Unsupported ACP protocol version ${response.protocolVersion}`,
        );
      }
      this.dispatch({ type: "connection.initialized", response });
      if (!(response.authMethods?.length ?? 0)) await this.afterAuthentication();
    } catch (error) {
      if (abortController.signal.aborted) {
        this.dispatch({ type: "connection.status", status: "closed" });
      } else {
        this.dispatch({ type: "connection.status", status: "error", error });
        this.reportError(error);
      }
      throw error;
    }
  }

  async reconnect(): Promise<void> {
    this.connection?.close();
    this.connection = undefined;
    await this.connect();
  }

  async authenticate(methodId: string): Promise<void> {
    const connection = this.requireConnection();
    await connection.authenticate(methodId);
    this.dispatch({ type: "connection.status", status: "ready" });
    await this.afterAuthentication();
  }

  async logout(): Promise<void> {
    if (!hasAgentCapability(this.state.capabilities, "logout")) {
      throw new AcpCapabilityError("logout");
    }
    await this.requireConnection().logout();
    this.dispatch({
      type: "connection.status",
      status: this.state.authMethods.length ? "auth-required" : "ready",
    });
  }

  private async afterAuthentication(): Promise<void> {
    if (hasAgentCapability(this.state.capabilities, "list")) {
      await this.refreshSessions();
    }
    if (this.options.threadId) await this.selectSession(this.options.threadId);
  }

  async refreshSessions(): Promise<void> {
    const connection = this.requireConnection();
    const sessions: SessionInfo[] = [];
    let cursor: string | undefined;
    do {
      const response = await connection.listSessions({
        ...(cursor ? { cursor } : {}),
      });
      sessions.push(...response.sessions);
      cursor = response.nextCursor ?? undefined;
    } while (cursor);
    this.dispatch({ type: "sessions.listed", sessions });
  }

  async createSession(): Promise<string> {
    const base = buildSessionRequest(this.options.workspace, this.state.capabilities);
    const response = await this.requireConnection().newSession(base);
    this.dispatch({
      type: "session.opened",
      sessionId: response.sessionId,
      modes: response.modes,
      configOptions: response.configOptions,
    });
    this.options.onThreadIdChange?.(response.sessionId);
    return response.sessionId;
  }

  async selectSession(sessionId: string): Promise<void> {
    if (this.state.activeSessionId === sessionId) return;
    const connection = this.requireConnection();
    const base = buildSessionRequest(this.options.workspace, this.state.capabilities);
    const known = this.state.sessions[sessionId];
    this.dispatch({ type: "session.selected", sessionId });

    if (known?.messages.length) {
      this.options.onThreadIdChange?.(sessionId);
      return;
    }

    if (hasAgentCapability(this.state.capabilities, "load")) {
      this.dispatch({ type: "session.loading", sessionId });
      const response = await connection.loadSession({ sessionId, ...base });
      this.dispatch({
        type: "session.opened",
        sessionId,
        info: known?.info,
        modes: response.modes,
        configOptions: response.configOptions,
        loading: true,
      });
      this.dispatch({ type: "session.loaded", sessionId });
    } else if (hasAgentCapability(this.state.capabilities, "resume")) {
      const response = await connection.resumeSession({ sessionId, ...base });
      this.dispatch({
        type: "session.opened",
        sessionId,
        info: known?.info,
        modes: response.modes,
        configOptions: response.configOptions,
      });
    } else {
      throw new AcpCapabilityError(
        "session/load or session/resume",
        "This agent cannot reopen an existing ACP session.",
      );
    }
    this.options.onThreadIdChange?.(sessionId);
  }

  async deleteSession(sessionId: string): Promise<void> {
    if (!hasAgentCapability(this.state.capabilities, "delete")) {
      throw new AcpCapabilityError("session/delete");
    }
    await this.requireConnection().deleteSession(sessionId);
    this.dispatch({ type: "session.deleted", sessionId });
  }

  async resumeSession(sessionId: string): Promise<void> {
    if (!hasAgentCapability(this.state.capabilities, "resume")) {
      throw new AcpCapabilityError("session/resume");
    }
    const response = await this.requireConnection().resumeSession({
      sessionId,
      ...buildSessionRequest(this.options.workspace, this.state.capabilities),
    });
    this.dispatch({
      type: "session.opened",
      sessionId,
      modes: response.modes,
      configOptions: response.configOptions,
    });
  }

  async closeSession(sessionId: string): Promise<void> {
    if (!hasAgentCapability(this.state.capabilities, "close")) {
      throw new AcpCapabilityError("session/close");
    }
    await this.requireConnection().closeSession(sessionId);
  }

  async prompt(
    sessionId: string,
    prompt: ContentBlock[],
  ): Promise<PromptResponse> {
    const session = this.state.sessions[sessionId];
    if (session?.runState === "running" || session?.runState === "cancelling") {
      throw new AcpError("ACP_TURN_RUNNING", "An ACP prompt turn is already running.");
    }
    this.dispatch({ type: "session.prompt_started", sessionId });
    try {
      const response = await this.requireConnection().prompt({ sessionId, prompt });
      this.dispatch({ type: "session.prompt_stopped", sessionId, response });
      return response;
    } catch (error) {
      this.dispatch({ type: "session.failed", sessionId, error });
      this.reportError(error);
      throw error;
    }
  }

  async sendMessage(message: AppendMessage): Promise<void> {
    const sessionId = this.state.activeSessionId ?? (await this.createSession());
    const prompt = serializeAppendMessage(message, this.state.capabilities);
    const messageId = `local:${sessionId}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    this.dispatch({
      type: "message.optimistic",
      sessionId,
      message: {
        id: messageId,
        role: "user",
        createdAt: Date.now(),
        optimistic: true,
        pieces: prompt.map((content) => ({
          type: "content" as const,
          content,
          raw: {
            sessionUpdate: "user_message_chunk" as const,
            content,
            messageId,
          },
        })),
      },
    });
    try {
      await this.prompt(sessionId, prompt);
    } catch (error) {
      this.dispatch({
        type: "message.optimistic_failed",
        sessionId,
        messageId,
        error,
      });
      throw error;
    }
  }

  async cancel(sessionId: string): Promise<void> {
    this.dispatch({ type: "session.cancel_started", sessionId });
    for (const [toolCallId, permission] of Object.entries(
      this.state.sessions[sessionId]?.permissions ?? {},
    )) {
      if (permission.status === "pending") {
        await this.replyToPermission(sessionId, toolCallId);
      }
    }
    await this.requireConnection().cancel(sessionId);
  }

  async setMode(sessionId: string, modeId: string): Promise<void> {
    if (!this.state.sessions[sessionId]?.modes) {
      throw new AcpCapabilityError("session/set_mode");
    }
    await this.requireConnection().setSessionMode({ sessionId, modeId });
  }

  async setConfigOption(
    sessionId: string,
    configId: string,
    value: string | boolean,
  ): Promise<void> {
    if (
      !this.state.sessions[sessionId]?.configOptions.some(
        (option) => option.id === configId,
      )
    ) {
      throw new AcpCapabilityError("session/set_config_option");
    }
    const response = await this.requireConnection().setSessionConfigOption({
      sessionId,
      configId,
      value,
    } as SetSessionConfigOptionRequest);
    this.dispatch({
      type: "session.update",
      notification: {
        sessionId,
        update: {
          sessionUpdate: "config_option_update",
          configOptions: response.configOptions,
        },
      },
    });
  }

  private waitForPermission(
    request: Parameters<NonNullable<Parameters<AcpClientAdapter["connect"]>[0]["handlers"]["requestPermission"]>>[0],
    signal: AbortSignal,
  ): Promise<RequestPermissionResponse> {
    this.dispatch({ type: "permission.requested", request });
    return new Promise((resolve, reject) => {
      const key = `${request.sessionId}:${request.toolCall.toolCallId}`;
      const abort = () => {
        const response: RequestPermissionResponse = {
          outcome: { outcome: "cancelled" },
        };
        this.permissionWaiters.delete(key);
        this.dispatch({
          type: "permission.resolved",
          sessionId: request.sessionId,
          toolCallId: request.toolCall.toolCallId,
          response,
        });
        signal.removeEventListener("abort", abort);
        resolve(response);
      };
      this.permissionWaiters.set(key, {
        resolve: (response) => {
          signal.removeEventListener("abort", abort);
          resolve(response);
        },
        reject: (error) => {
          signal.removeEventListener("abort", abort);
          reject(error);
        },
      });
      if (signal.aborted) abort();
      else signal.addEventListener("abort", abort, { once: true });
    });
  }

  async replyToPermission(
    sessionId: string,
    toolCallId: string,
    optionId?: string,
  ): Promise<void> {
    const key = `${sessionId}:${toolCallId}`;
    const waiter = this.permissionWaiters.get(key);
    if (!waiter) return;
    const response: RequestPermissionResponse = optionId
      ? { outcome: { outcome: "selected", optionId } }
      : { outcome: { outcome: "cancelled" } };
    this.permissionWaiters.delete(key);
    this.dispatch({
      type: "permission.resolved",
      sessionId,
      toolCallId,
      response,
    });
    waiter.resolve(response);
  }

  dispose(): void {
    this.disposed = true;
    this.abortController?.abort(new AcpError("ACP_DISPOSED", "Controller disposed"));
    this.connection?.close();
    for (const waiter of this.permissionWaiters.values()) {
      waiter.reject(new AcpError("ACP_DISPOSED", "Controller disposed"));
    }
    this.permissionWaiters.clear();
    this.listeners.clear();
  }

  disconnect(): void {
    this.abortController?.abort();
    this.connection?.close();
    this.connection = undefined;
    for (const waiter of this.permissionWaiters.values()) {
      waiter.reject(new AcpError("ACP_DISCONNECTED", "ACP disconnected"));
    }
    this.permissionWaiters.clear();
  }

  private requireConnection(): AcpClientConnection {
    if (!this.connection || this.connection.signal.aborted) {
      throw new AcpError("ACP_NOT_CONNECTED", "ACP is not connected.");
    }
    return this.connection;
  }
}

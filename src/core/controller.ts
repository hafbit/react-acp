import {
  PROTOCOL_VERSION,
  type ContentBlock,
  type PromptResponse,
  type RequestPermissionResponse,
  type SetSessionConfigOptionRequest,
  type SessionInfo,
  type SessionNotification,
} from "@agentclientprotocol/sdk";
import type { AppendMessage } from "@assistant-ui/react";
import { REACT_ACP_VERSION } from "../version";
import { AcpCapabilityError, AcpError } from "./errors";
import { toError } from "./internal-errors";
import { SdkAcpClientAdapter } from "./sdk-adapter";
import {
  createAcpSessionState,
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

type SelectSessionOptions = {
  notify?: boolean;
  force?: boolean;
  method?: "auto" | "resume";
};

type PendingOutbound = {
  messageId: string;
  prompt: readonly ContentBlock[];
  buffered: SessionNotification[];
  protocolMessageId?: string;
  echoDisabled: boolean;
  confirmed: boolean;
};

const comparableContent = (content: ContentBlock): unknown => {
  const value = { ...content } as Record<string, unknown>;
  Reflect.deleteProperty(value, "_meta");
  return value;
};

const coalesceText = (blocks: readonly ContentBlock[]): ContentBlock[] => {
  const result: ContentBlock[] = [];
  for (const block of blocks) {
    const previous = result.at(-1);
    if (block.type === "text" && previous?.type === "text") {
      result[result.length - 1] = { ...previous, text: previous.text + block.text };
    } else {
      result.push(block);
    }
  }
  return result;
};

const equalNonTextContent = (left: ContentBlock, right: ContentBlock): boolean =>
  JSON.stringify(comparableContent(left)) === JSON.stringify(comparableContent(right));

const echoRelation = (
  prompt: readonly ContentBlock[],
  notifications: readonly SessionNotification[],
): "prefix" | "equal" | "different" => {
  const expected = coalesceText(prompt);
  const actual = coalesceText(
    notifications.map((notification) => {
      const update = notification.update;
      if (update.sessionUpdate !== "user_message_chunk") {
        throw new AcpError("ACP_INTERNAL", "Expected buffered user message chunks.");
      }
      return update.content;
    }),
  );
  if (actual.length > expected.length) return "different";

  for (let index = 0; index < actual.length; index += 1) {
    const incoming = actual[index]!;
    const target = expected[index];
    if (!target || incoming.type !== target.type) return "different";
    if (incoming.type === "text" && target.type === "text") {
      const last = index === actual.length - 1;
      if (last ? !target.text.startsWith(incoming.text) : target.text !== incoming.text) {
        return "different";
      }
    } else if (!equalNonTextContent(incoming, target)) {
      return "different";
    }
  }

  if (actual.length !== expected.length) return "prefix";
  const lastActual = actual.at(-1);
  const lastExpected = expected.at(-1);
  if (lastActual?.type === "text" && lastExpected?.type === "text") {
    return lastActual.text === lastExpected.text ? "equal" : "prefix";
  }
  return "equal";
};

/** Owns one ACP connection and the protocol-authoritative session repository. */
export class AcpThreadController {
  private state = createAcpThreadState();
  private readonly listeners = new Set<() => void>();
  private connection?: AcpClientConnection;
  private abortController?: AbortController;
  private connectPromise?: Promise<void>;
  private readonly permissionWaiters = new Map<string, PermissionWaiter>();
  private readonly attachedSessions = new Set<string>();
  private readonly attachmentPromises = new Map<string, Promise<void>>();
  private readonly loadingSessions = new Set<string>();
  private readonly pendingOutbound = new Map<string, PendingOutbound>();
  private connectionGeneration = 0;
  private selectionGeneration = 0;
  private settledActiveSessionId?: string;
  private disposed = false;

  /** Creates a controller and validates the configured workspace paths. */
  constructor(private readonly options: AcpRuntimeOptions) {
    validateWorkspace(options.workspace);
  }

  /** Returns the current immutable thread-state snapshot. */
  getState = (): AcpThreadState => this.state;

  /** Subscribes to state changes and returns an unsubscribe function. */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
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

  /** Opens and initializes the ACP connection; concurrent calls share one attempt. */
  async connect(): Promise<void> {
    if (this.disposed) throw new AcpError("ACP_DISPOSED", "Controller disposed");
    if (this.connection && !this.connection.signal.aborted) return;
    if (this.connectPromise) {
      const pending = this.connectPromise;
      try {
        await pending;
      } catch {
        // React StrictMode can abort the first setup before the replacement starts.
      }
      if (!this.connection || this.connection.signal.aborted) return this.connect();
      return;
    }

    this.connectPromise = this.doConnect().finally(() => {
      this.connectPromise = undefined;
    });
    return this.connectPromise;
  }

  private async doConnect(): Promise<void> {
    this.abortController?.abort();
    const generation = ++this.connectionGeneration;
    const abortController = new AbortController();
    this.abortController = abortController;
    this.attachedSessions.clear();
    this.attachmentPromises.clear();
    this.loadingSessions.clear();
    this.dispatch({ type: "connection.status", status: "connecting" });

    try {
      const services = this.options.clientServices;
      const connection = await this.adapter.connect({
        signal: abortController.signal,
        handlers: {
          sessionUpdate: (notification) => this.handleSessionUpdate(generation, notification),
          requestPermission: (request, signal) => {
            if (generation !== this.connectionGeneration) {
              return { outcome: { outcome: "cancelled" } };
            }
            this.flushEchoBoundary(request.sessionId);
            return this.waitForPermission(request, signal);
          },
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
      if (generation !== this.connectionGeneration) {
        connection.close();
        throw new AcpError("ACP_DISCONNECTED", "ACP connection was superseded.");
      }
      this.connection = connection;
      connection.signal.addEventListener(
        "abort",
        () => {
          if (!this.disposed && generation === this.connectionGeneration) {
            this.connection = undefined;
            this.attachedSessions.clear();
            this.dispatch({ type: "connection.status", status: "closed" });
          }
        },
        { once: true },
      );

      const response = await connection.initialize({
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: buildClientCapabilities(services, this.options.clientCapabilities),
        clientInfo: this.options.clientInfo ?? {
          name: "react-acp",
          version: REACT_ACP_VERSION,
        },
      });
      if (generation !== this.connectionGeneration || abortController.signal.aborted) {
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
      const authenticationRequired = await this.isAuthenticationRequired(connection, response);
      if (generation !== this.connectionGeneration || abortController.signal.aborted) {
        connection.close(abortController.signal.reason);
        throw new AcpError("ACP_DISCONNECTED", "ACP connection was aborted.");
      }
      this.dispatch({
        type: "connection.status",
        status: authenticationRequired ? "auth-required" : "ready",
      });
      if (!authenticationRequired) await this.afterAuthentication(generation);
    } catch (error) {
      if (generation !== this.connectionGeneration) throw error;
      if (abortController.signal.aborted) {
        this.dispatch({ type: "connection.status", status: "closed" });
      } else {
        this.dispatch({ type: "connection.status", status: "error", error });
        this.reportError(error);
      }
      throw error;
    }
  }

  /** Closes the current connection and starts a fresh initialization. */
  async reconnect(): Promise<void> {
    this.disconnectTransport();
    await this.connect();
  }

  /** Authenticates with an advertised method and completes session setup. */
  async authenticate(methodId: string): Promise<void> {
    const generation = this.connectionGeneration;
    const connection = this.requireConnection();
    await connection.authenticate(methodId);
    if (generation !== this.connectionGeneration) return;
    this.dispatch({ type: "connection.status", status: "ready" });
    await this.afterAuthentication(generation);
  }

  /** Logs out when the agent advertises the ACP logout capability. */
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

  private async isAuthenticationRequired(
    connection: AcpClientConnection,
    response: { authMethods?: readonly unknown[] | null },
  ): Promise<boolean> {
    if (!(response.authMethods?.length ?? 0)) return false;
    const authenticationStatus = await connection.authenticationStatus?.();
    if (!authenticationStatus) return true;
    return authenticationStatus.type === "unauthenticated";
  }

  private async afterAuthentication(generation: number): Promise<void> {
    if (hasAgentCapability(this.state.capabilities, "list")) await this.refreshSessions();
    if (generation !== this.connectionGeneration) return;
    const activeSessionId = this.state.activeSessionId;
    if (!activeSessionId) return;
    try {
      await this.attachSession(activeSessionId, { force: true });
      this.settledActiveSessionId = activeSessionId;
    } catch (error) {
      this.reportError(error);
    }
  }

  /** Loads every page of the agent's session list into local state. */
  async refreshSessions(): Promise<void> {
    const generation = this.connectionGeneration;
    const connection = this.requireConnection();
    const sessions: SessionInfo[] = [];
    let cursor: string | undefined;
    do {
      const response = await connection.listSessions(cursor ? { cursor } : {});
      if (generation !== this.connectionGeneration) return;
      sessions.push(...response.sessions);
      cursor = response.nextCursor ?? undefined;
    } while (cursor);
    this.dispatch({ type: "sessions.listed", sessions });
  }

  /** Creates, attaches, and selects a new ACP session. */
  async createSession(): Promise<string> {
    const token = ++this.selectionGeneration;
    const generation = this.connectionGeneration;
    const response = await this.requireConnection().newSession(
      buildSessionRequest(this.options.workspace, this.state.capabilities),
    );
    if (generation !== this.connectionGeneration) {
      throw new AcpError("ACP_DISCONNECTED", "ACP connection changed while creating a session.");
    }
    this.attachedSessions.add(response.sessionId);
    this.dispatch({
      type: "session.attached",
      sessionId: response.sessionId,
      modes: response.modes,
      configOptions: response.configOptions,
    });
    if (token === this.selectionGeneration) {
      this.dispatch({ type: "session.selected", sessionId: response.sessionId });
      this.settledActiveSessionId = response.sessionId;
      this.options.onThreadIdChange?.(response.sessionId);
    }
    return response.sessionId;
  }

  /** Selects a session; only the latest in-flight selection may become active. */
  async selectSession(sessionId: string, options: SelectSessionOptions = {}): Promise<void> {
    const notify = options.notify ?? true;
    if (
      !options.force &&
      this.state.activeSessionId === sessionId &&
      this.attachedSessions.has(sessionId)
    ) {
      return;
    }

    const token = ++this.selectionGeneration;
    const fallbackSessionId = this.settledActiveSessionId;
    try {
      await this.attachSession(sessionId, options);
    } catch (error) {
      if (token === this.selectionGeneration) {
        this.dispatch({ type: "session.selected", sessionId: fallbackSessionId });
      }
      throw error;
    }
    if (token !== this.selectionGeneration) return;
    this.dispatch({ type: "session.selected", sessionId });
    this.settledActiveSessionId = sessionId;
    if (notify) this.options.onThreadIdChange?.(sessionId);
  }

  private async attachSession(
    sessionId: string,
    options: Pick<SelectSessionOptions, "force" | "method"> = {},
  ): Promise<void> {
    if (!options.force && this.attachedSessions.has(sessionId)) return;
    const pending = this.attachmentPromises.get(sessionId);
    if (pending) return pending;

    const promise = this.performAttach(sessionId, options);
    this.attachmentPromises.set(sessionId, promise);
    try {
      await promise;
    } finally {
      if (this.attachmentPromises.get(sessionId) === promise) {
        this.attachmentPromises.delete(sessionId);
      }
    }
  }

  private async performAttach(
    sessionId: string,
    options: Pick<SelectSessionOptions, "method">,
  ): Promise<void> {
    const generation = this.connectionGeneration;
    const connection = this.requireConnection();
    const snapshot = this.state.sessions[sessionId] ?? createAcpSessionState(sessionId);
    const base = buildSessionRequest(this.options.workspace, this.state.capabilities);
    const useResume =
      options.method === "resume" ||
      (!hasAgentCapability(this.state.capabilities, "load") &&
        hasAgentCapability(this.state.capabilities, "resume"));

    if (options.method === "resume" && !hasAgentCapability(this.state.capabilities, "resume")) {
      throw new AcpCapabilityError("session/resume");
    }
    if (!useResume && !hasAgentCapability(this.state.capabilities, "load")) {
      const error = new AcpCapabilityError(
        "session/load or session/resume",
        "This agent cannot reopen an existing ACP session.",
      );
      this.dispatch({ type: "session.attach_failed", sessionId, error });
      throw error;
    }

    this.dispatch({ type: "session.loading", sessionId, clearHistory: !useResume });
    if (!useResume) this.loadingSessions.add(sessionId);
    try {
      const response = useResume
        ? await connection.resumeSession({ sessionId, ...base })
        : await connection.loadSession({ sessionId, ...base });
      if (generation !== this.connectionGeneration) {
        throw new AcpError("ACP_DISCONNECTED", "ACP connection changed while attaching a session.");
      }
      this.attachedSessions.add(sessionId);
      this.dispatch({
        type: "session.attached",
        sessionId,
        info: snapshot.info,
        modes: response.modes,
        configOptions: response.configOptions,
      });
    } catch (error) {
      if (generation === this.connectionGeneration) {
        this.dispatch({ type: "session.restored", session: snapshot, error });
      }
      throw error;
    } finally {
      this.loadingSessions.delete(sessionId);
    }
  }

  /** Permanently deletes a session when the agent advertises support. */
  async deleteSession(sessionId: string): Promise<void> {
    if (!hasAgentCapability(this.state.capabilities, "delete")) {
      throw new AcpCapabilityError("session/delete");
    }
    await this.requireConnection().deleteSession(sessionId);
    this.attachedSessions.delete(sessionId);
    this.dispatch({ type: "session.deleted", sessionId });
    if (this.settledActiveSessionId === sessionId) {
      ++this.selectionGeneration;
      this.settledActiveSessionId = undefined;
      this.options.onThreadIdChange?.(undefined);
    }
  }

  /** Explicitly resumes and selects a session. */
  async resumeSession(sessionId: string): Promise<void> {
    await this.selectSession(sessionId, { force: true, method: "resume" });
  }

  /** Closes a session without deleting its cached history. */
  async closeSession(sessionId: string): Promise<void> {
    if (!hasAgentCapability(this.state.capabilities, "close")) {
      throw new AcpCapabilityError("session/close");
    }
    await this.cancelPendingPermissions(sessionId);
    await this.requireConnection().closeSession(sessionId);
    this.attachedSessions.delete(sessionId);
    this.dispatch({ type: "session.closed", sessionId });
    if (this.state.activeSessionId === sessionId) {
      ++this.selectionGeneration;
      this.dispatch({ type: "session.selected", sessionId: undefined });
      this.settledActiveSessionId = undefined;
      this.options.onThreadIdChange?.(undefined);
    }
  }

  /** Sends one serialized ACP prompt turn and records its lifecycle. */
  async prompt(sessionId: string, prompt: ContentBlock[]): Promise<PromptResponse> {
    if (!this.attachedSessions.has(sessionId)) {
      throw new AcpError(
        "ACP_SESSION_NOT_ATTACHED",
        `ACP session '${sessionId}' is not attached to the current connection.`,
      );
    }
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
      this.dispatch({ type: "session.turn_failed", sessionId, error });
      this.reportError(error);
      throw error;
    }
  }

  /** Serializes and sends an assistant-ui user message with optimistic projection. */
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
        pieces: prompt.map((content) => ({ type: "content" as const, content })),
        rawNotifications: [],
      },
    });
    this.pendingOutbound.set(sessionId, {
      messageId,
      prompt,
      buffered: [],
      echoDisabled: false,
      confirmed: false,
    });
    try {
      await this.prompt(sessionId, prompt);
      this.finishPendingOutbound(sessionId, true);
    } catch (error) {
      this.finishPendingOutbound(sessionId, false);
      this.dispatch({ type: "message.optimistic_failed", sessionId, messageId, error });
      throw error;
    }
  }

  private handleSessionUpdate(generation: number, notification: SessionNotification): void {
    if (generation !== this.connectionGeneration) return;
    const sessionId = notification.sessionId;
    const update = notification.update;
    const pending = this.pendingOutbound.get(sessionId);

    if (
      pending &&
      !this.loadingSessions.has(sessionId) &&
      update.sessionUpdate === "user_message_chunk" &&
      !pending.echoDisabled
    ) {
      const incomingId = update.messageId ?? undefined;
      if (pending.protocolMessageId && incomingId && pending.protocolMessageId !== incomingId) {
        this.flushBufferedOutbound(sessionId);
        pending.echoDisabled = true;
        this.dispatch({ type: "session.update", notification });
        return;
      }
      pending.protocolMessageId ??= incomingId;
      pending.buffered.push(notification);
      const relation = echoRelation(pending.prompt, pending.buffered);
      if (relation === "equal") {
        this.dispatch({
          type: "message.optimistic_confirmed",
          sessionId,
          messageId: pending.messageId,
          protocolMessageId: pending.protocolMessageId,
          notifications: pending.buffered,
        });
        pending.buffered = [];
        pending.confirmed = true;
        pending.echoDisabled = true;
      } else if (relation === "different") {
        this.flushBufferedOutbound(sessionId);
        pending.echoDisabled = true;
      }
      return;
    }

    if (pending && update.sessionUpdate !== "user_message_chunk") {
      this.flushEchoBoundary(sessionId);
    }
    this.dispatch({ type: "session.update", notification });
  }

  private flushEchoBoundary(sessionId: string): void {
    const pending = this.pendingOutbound.get(sessionId);
    if (!pending?.buffered.length) return;
    this.flushBufferedOutbound(sessionId);
    pending.echoDisabled = true;
  }

  private flushBufferedOutbound(sessionId: string): void {
    const pending = this.pendingOutbound.get(sessionId);
    if (!pending) return;
    for (const notification of pending.buffered) {
      this.dispatch({ type: "session.update", notification });
    }
    pending.buffered = [];
  }

  private finishPendingOutbound(sessionId: string, succeeded: boolean): void {
    const pending = this.pendingOutbound.get(sessionId);
    if (!pending) return;
    this.flushBufferedOutbound(sessionId);
    if (succeeded && !pending.confirmed) {
      this.dispatch({
        type: "message.optimistic_confirmed",
        sessionId,
        messageId: pending.messageId,
      });
    }
    this.pendingOutbound.delete(sessionId);
  }

  /** Cancels pending permissions and the active prompt turn for a session. */
  async cancel(sessionId: string): Promise<void> {
    this.dispatch({ type: "session.cancel_started", sessionId });
    await this.cancelPendingPermissions(sessionId);
    await this.requireConnection().cancel(sessionId);
  }

  private async cancelPendingPermissions(sessionId: string): Promise<void> {
    for (const [toolCallId, permission] of Object.entries(
      this.state.sessions[sessionId]?.permissions ?? {},
    )) {
      if (permission.status === "pending") await this.replyToPermission(sessionId, toolCallId);
    }
  }

  /** Changes a session mode when modes were advertised by the agent. */
  async setMode(sessionId: string, modeId: string): Promise<void> {
    if (!this.state.sessions[sessionId]?.modes) {
      throw new AcpCapabilityError("session/set_mode");
    }
    await this.requireConnection().setSessionMode({ sessionId, modeId });
  }

  /** Changes an advertised session configuration option. */
  async setConfigOption(
    sessionId: string,
    configId: string,
    value: string | boolean,
  ): Promise<void> {
    if (!this.state.sessions[sessionId]?.configOptions.some((option) => option.id === configId)) {
      throw new AcpCapabilityError("session/set_config_option");
    }
    const response = await this.requireConnection().setSessionConfigOption({
      sessionId,
      configId,
      value,
    } as SetSessionConfigOptionRequest);
    this.dispatch({
      type: "session.config_options",
      sessionId,
      configOptions: response.configOptions,
    });
  }

  private waitForPermission(
    request: Parameters<
      NonNullable<Parameters<AcpClientAdapter["connect"]>[0]["handlers"]["requestPermission"]>
    >[0],
    signal: AbortSignal,
  ): Promise<RequestPermissionResponse> {
    this.dispatch({ type: "permission.requested", request });
    return new Promise((resolve, reject) => {
      const key = `${request.sessionId}:${request.toolCall.toolCallId}`;
      const abort = () => {
        const response: RequestPermissionResponse = { outcome: { outcome: "cancelled" } };
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
          reject(toError(error));
        },
      });
      if (signal.aborted) abort();
      else signal.addEventListener("abort", abort, { once: true });
    });
  }

  /** Resolves a pending permission, or cancels it when optionId is omitted. */
  async replyToPermission(sessionId: string, toolCallId: string, optionId?: string): Promise<void> {
    const key = `${sessionId}:${toolCallId}`;
    const waiter = this.permissionWaiters.get(key);
    if (!waiter) return;
    const response: RequestPermissionResponse = optionId
      ? { outcome: { outcome: "selected", optionId } }
      : { outcome: { outcome: "cancelled" } };
    this.permissionWaiters.delete(key);
    this.dispatch({ type: "permission.resolved", sessionId, toolCallId, response });
    waiter.resolve(response);
  }

  /** Permanently disposes the controller and rejects pending permission requests. */
  dispose(): void {
    this.disposed = true;
    this.disconnectTransport(new AcpError("ACP_DISPOSED", "Controller disposed"));
    this.listeners.clear();
  }

  /** Disconnects the current transport while allowing a later reconnect. */
  disconnect(): void {
    this.disconnectTransport(new AcpError("ACP_DISCONNECTED", "ACP disconnected"));
  }

  private disconnectTransport(reason?: unknown): void {
    ++this.connectionGeneration;
    this.abortController?.abort(reason);
    this.connection?.close(reason);
    this.connection = undefined;
    this.attachedSessions.clear();
    this.attachmentPromises.clear();
    this.loadingSessions.clear();
    for (const waiter of this.permissionWaiters.values()) waiter.reject(reason);
    this.permissionWaiters.clear();
  }

  private requireConnection(): AcpClientConnection {
    if (!this.connection || this.connection.signal.aborted) {
      throw new AcpError("ACP_NOT_CONNECTED", "ACP is not connected.");
    }
    return this.connection;
  }
}

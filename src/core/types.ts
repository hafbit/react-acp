import type {
  AgentCapabilities,
  AuthMethod,
  ClientCapabilities,
  ContentBlock,
  CreateTerminalRequest,
  CreateTerminalResponse,
  DeleteSessionResponse,
  InitializeRequest,
  InitializeResponse,
  ListSessionsRequest,
  ListSessionsResponse,
  LoadSessionRequest,
  LoadSessionResponse,
  LogoutResponse,
  McpServer,
  NewSessionRequest,
  NewSessionResponse,
  PromptRequest,
  PromptResponse,
  ReadTextFileRequest,
  ReadTextFileResponse,
  ReleaseTerminalRequest,
  RequestPermissionRequest,
  RequestPermissionResponse,
  ResumeSessionRequest,
  ResumeSessionResponse,
  SessionConfigOption,
  SessionId,
  SessionInfo,
  SessionModeState,
  SessionNotification,
  SessionUpdate,
  SetSessionConfigOptionRequest,
  SetSessionConfigOptionResponse,
  SetSessionModeRequest,
  StopReason,
  Stream,
  TerminalOutputRequest,
  TerminalOutputResponse,
  ToolCall,
  ToolCallUpdate,
  UsageUpdate,
  WaitForTerminalExitRequest,
  WaitForTerminalExitResponse,
  WriteTextFileRequest,
} from "@agentclientprotocol/sdk";
import type {
  AssistantRuntime,
  ExternalStoreSharedOptions,
  RuntimeAdapters,
  ThreadMessageLike,
} from "@assistant-ui/react";

/** A value that may be returned synchronously or asynchronously by host services. */
export type MaybePromise<T> = T | Promise<T>;

/** Lifecycle state of the ACP client connection. */
export type AcpConnectionStatus =
  "idle" | "connecting" | "auth-required" | "ready" | "error" | "closed";

/** Authentication state returned by an optional agent status extension. */
export type AcpAuthenticationStatus = Readonly<{
  /** `unauthenticated` means login is required; other values identify the active method. */
  type: string;
  /** Agent-specific authentication metadata. */
  [key: string]: unknown;
}>;

/** Workspace data supplied when creating, loading, or resuming ACP sessions. */
export type AcpWorkspace = {
  /** Absolute working-directory path exposed to the ACP agent. */
  cwd: string;
  /** MCP servers made available to the session. Defaults to an empty list. */
  mcpServers?: readonly McpServer[];
  /** Extra absolute workspace paths, sent only when the agent advertises support. */
  additionalDirectories?: readonly string[];
};

/** Creates the bidirectional ACP stream used by the SDK adapter. */
export type AcpStreamFactory = (context: {
  /** Aborts when the runtime disconnects or is disposed. */
  signal: AbortSignal;
}) => MaybePromise<Stream>;

/** Configures either an SDK stream or a fully custom ACP client adapter. */
export type AcpConnectionSource =
  | { type: "stream"; createStream: AcpStreamFactory }
  | { type: "adapter"; adapter: AcpClientAdapter };

/** Optional host filesystem services that an ACP agent may call. */
export type AcpFileSystemServices = {
  /** Reads a text file after the host applies its own access policy. */
  readTextFile?: (
    request: ReadTextFileRequest,
    signal: AbortSignal,
  ) => MaybePromise<ReadTextFileResponse>;
  /** Writes a text file after the host applies its own access policy. */
  writeTextFile?: (request: WriteTextFileRequest, signal: AbortSignal) => MaybePromise<void>;
};

/** Complete host terminal service required before terminal capability is advertised. */
export type AcpTerminalServices = {
  /** Creates a terminal process for an ACP request. */
  create: (
    request: CreateTerminalRequest,
    signal: AbortSignal,
  ) => MaybePromise<CreateTerminalResponse>;
  /** Returns terminal output for an ACP request. */
  output: (
    request: TerminalOutputRequest,
    signal: AbortSignal,
  ) => MaybePromise<TerminalOutputResponse>;
  /** Releases host resources associated with a terminal. */
  release: (request: ReleaseTerminalRequest, signal: AbortSignal) => MaybePromise<void>;
  /** Waits for a terminal process to exit. */
  waitForExit: (
    request: WaitForTerminalExitRequest,
    signal: AbortSignal,
  ) => MaybePromise<WaitForTerminalExitResponse>;
  /** Terminates a terminal process. */
  kill: (
    request: { sessionId: SessionId; terminalId: string },
    signal: AbortSignal,
  ) => MaybePromise<void>;
};

/** Host services that can be exposed to the connected ACP agent. */
export type AcpClientServices = {
  /** Optional filesystem operations. */
  fileSystem?: AcpFileSystemServices;
  /** Terminal operations; advertised only when the complete service is present. */
  terminal?: AcpTerminalServices;
};

/** Notification and request handlers installed on an ACP client connection. */
export type AcpClientHandlers = {
  /** Applies a session notification to runtime state. */
  sessionUpdate(notification: SessionNotification): MaybePromise<void>;
  /** Waits for the host application to resolve an ACP tool permission. */
  requestPermission(
    request: RequestPermissionRequest,
    signal: AbortSignal,
  ): MaybePromise<RequestPermissionResponse>;
  /** Handles an agent request to read a text file. */
  readTextFile?(
    request: ReadTextFileRequest,
    signal: AbortSignal,
  ): MaybePromise<ReadTextFileResponse>;
  /** Handles an agent request to write a text file. */
  writeTextFile?(request: WriteTextFileRequest, signal: AbortSignal): MaybePromise<void>;
  /** Handles the complete set of agent terminal requests. */
  terminal?: AcpTerminalServices;
};

/** Values passed to an {@link AcpClientAdapter} when connecting. */
export type AcpAdapterConnectOptions = {
  /** Aborts the connection and all pending requests. */
  signal: AbortSignal;
  /** Runtime handlers that receive agent notifications and requests. */
  handlers: AcpClientHandlers;
};

/** Runtime-facing facade over a connected ACP client transport. */
export interface AcpClientConnection {
  /** Aborts when the underlying connection closes. */
  readonly signal: AbortSignal;
  /** Negotiates protocol version, capabilities, and authentication methods. */
  initialize(request: InitializeRequest): Promise<InitializeResponse>;
  /** Returns current authentication state when the agent supports a status extension. */
  authenticationStatus?(): Promise<AcpAuthenticationStatus | undefined>;
  /** Authenticates with one method advertised during initialization. */
  authenticate(methodId: string): Promise<void>;
  /** Logs out when the agent advertises logout support. */
  logout(): Promise<LogoutResponse | void>;
  /** Creates a new ACP session. */
  newSession(request: NewSessionRequest): Promise<NewSessionResponse>;
  /** Loads an existing ACP session and its history. */
  loadSession(request: LoadSessionRequest): Promise<LoadSessionResponse>;
  /** Lists accessible ACP sessions. */
  listSessions(request: ListSessionsRequest): Promise<ListSessionsResponse>;
  /** Deletes an ACP session. */
  deleteSession(sessionId: SessionId): Promise<DeleteSessionResponse | void>;
  /** Resumes an existing ACP session. */
  resumeSession(request: ResumeSessionRequest): Promise<ResumeSessionResponse>;
  /** Closes an ACP session without deleting it. */
  closeSession(sessionId: SessionId): Promise<void>;
  /** Changes the active mode of a session. */
  setSessionMode(request: SetSessionModeRequest): Promise<void>;
  /** Changes one advertised session configuration option. */
  setSessionConfigOption(
    request: SetSessionConfigOptionRequest,
  ): Promise<SetSessionConfigOptionResponse>;
  /** Sends one user prompt turn. */
  prompt(request: PromptRequest): Promise<PromptResponse>;
  /** Requests cancellation of the active prompt turn. */
  cancel(sessionId: SessionId): Promise<void>;
  /** Closes the transport and rejects pending work. */
  close(error?: unknown): void;
}

/** Custom transport boundary used when the built-in SDK stream adapter is unsuitable. */
export interface AcpClientAdapter {
  /** Opens an ACP connection and installs the supplied handlers. */
  connect(options: AcpAdapterConnectOptions): Promise<AcpClientConnection>;
}

/** Ordered protocol fragment retained inside a projected ACP message. */
export type AcpMessagePiece =
  | { type: "content"; content: ContentBlock; notification?: SessionNotification }
  | { type: "tool"; toolCallId: string }
  | {
      type: "plan";
      plan: Extract<SessionUpdate, { sessionUpdate: "plan" }>;
      notification: SessionNotification;
    }
  | { type: "unsupported"; notification: SessionNotification };

/** Protocol-authoritative message record retained in ACP session state. */
export type AcpMessageRecord = {
  /** Stable ACP message ID, or a locally generated ID when the agent omits one. */
  id: string;
  /** Message author. */
  role: "user" | "assistant";
  /** Opaque ACP message ID associated with a locally stable projected ID. */
  protocolMessageId?: string;
  /** Local creation time in Unix milliseconds. */
  createdAt: number;
  /** Ordered raw content, tool, plan, and unsupported protocol pieces. */
  pieces: readonly AcpMessagePiece[];
  /** Complete ACP notifications owned directly by this message. */
  rawNotifications: readonly SessionNotification[];
  /** Assistant turn completion state. */
  status?:
    | { type: "running" }
    | { type: "complete"; stopReason: StopReason }
    | { type: "incomplete"; stopReason?: StopReason; error?: unknown };
  /** Whether this local user message is awaiting authoritative ACP updates. */
  optimistic?: boolean;
  /** Serialization, transport, or turn failure associated with the message. */
  error?: unknown;
};

/** Latest state and full raw notification history for one ACP tool call. */
export type AcpToolCallRecord = {
  /** ACP tool call identifier. */
  toolCallId: string;
  /** Message that owns the projected tool call. */
  messageId: string;
  /** Latest merged tool call value. */
  value: ToolCall | ToolCallUpdate;
  /** Associated permission request, when approval is required. */
  permission?: AcpPermissionRecord;
  /** Tool call notifications in arrival order. */
  rawNotifications: readonly SessionNotification[];
};

/** Lifecycle state for an ACP tool permission request. */
export type AcpPermissionRecord = {
  /** Original ACP permission request. */
  request: RequestPermissionRequest;
  /** Whether the request awaits a reply, was resolved, or was cancelled. */
  status: "pending" | "resolved" | "cancelled";
  /** Protocol response returned to the agent after resolution. */
  response?: RequestPermissionResponse;
};

/** Lifecycle state of the current prompt turn in an ACP session. */
export type AcpSessionRunState = "idle" | "loading" | "running" | "cancelling" | "error";

/** Whether the current ACP attachment may mutate its native session. */
export type AcpSessionAccess = {
  /** Read-only attachments can display history but must not issue mutating requests. */
  mode: "read-write" | "read-only";
  /** Agent-specific reason for restricting the attachment. */
  reason?: string;
};

/** Context supplied when an extension determines access for an attached session. */
export type AcpSessionAccessContext =
  | { method: "load"; response: LoadSessionResponse }
  | { method: "resume"; response: ResumeSessionResponse };

/** Optional application-owned interpretations of opaque ACP extension metadata. */
export type AcpRuntimeExtensionAdapter = {
  /** Resolves access from an attach response. Defaults to read-write. */
  sessionAccess?(context: AcpSessionAccessContext): AcpSessionAccess | undefined;
  /** Returns an application-defined grouping phase for one raw session notification. */
  messagePhase?(notification: SessionNotification): string | undefined;
};

/** Protocol-authoritative state retained for one ACP session. */
export type AcpSessionState = {
  /** ACP session identifier. */
  sessionId: SessionId;
  /** Latest session metadata, when supplied by the agent. */
  info?: SessionInfo;
  /** Current load, prompt, cancellation, or failure state. */
  runState: AcpSessionRunState;
  /** Access negotiated while creating, loading, or resuming the session. */
  access: AcpSessionAccess;
  /** Messages in protocol order. */
  messages: readonly AcpMessageRecord[];
  /** Tool calls indexed by tool call ID. */
  tools: Readonly<Record<string, AcpToolCallRecord>>;
  /** Permission requests indexed by tool call ID. */
  permissions: Readonly<Record<string, AcpPermissionRecord>>;
  /** Latest plan update. */
  plan?: Extract<SessionUpdate, { sessionUpdate: "plan" }>;
  /** Commands currently advertised by the agent. */
  commands: Extract<
    SessionUpdate,
    { sessionUpdate: "available_commands_update" }
  >["availableCommands"];
  /** Available and selected modes, or `null` when explicitly unavailable. */
  modes?: SessionModeState | null;
  /** Configuration options currently advertised by the agent. */
  configOptions: readonly SessionConfigOption[];
  /** Latest usage update. */
  usage?: UsageUpdate;
  /** Number of prompt turns started locally. */
  turn: number;
  /** Last message receiving streamed chunks during the active turn. */
  lastChunk?: { role: "user" | "assistant"; messageId: string };
  /** Most recent assistant message used to associate tools and plans. */
  lastAssistantMessageId?: string;
  /** Latest full notification for each interpreted session-level update kind. */
  latestNotifications: Readonly<Record<string, SessionNotification>>;
  /** Forward-compatible notifications not interpreted by this version. */
  unhandledNotifications: readonly SessionNotification[];
  /** Latest session-level failure. */
  error?: unknown;
};

/** Complete connection and session repository managed by one ACP controller. */
export type AcpThreadState = {
  /** Current connection lifecycle status. */
  connectionStatus: AcpConnectionStatus;
  /** Latest connection failure. */
  connectionError?: unknown;
  /** Successful ACP initialization response. */
  initializeResponse?: InitializeResponse;
  /** Agent capabilities negotiated during initialization. */
  capabilities?: AgentCapabilities;
  /** Authentication methods advertised by the agent. */
  authMethods: readonly AuthMethod[];
  /** Sessions indexed by ACP session ID. */
  sessions: Readonly<Record<string, AcpSessionState>>;
  /** Stable display order for known session IDs. */
  sessionOrder: readonly string[];
  /** Active draft session intentionally omitted from visible thread lists. */
  preparedSessionId?: string;
  /** Session projected as the active assistant-ui thread. */
  activeSessionId?: string;
};

/** Event union consumed by {@link reduceAcpThreadState}. */
export type AcpStateEvent =
  | { type: "connection.status"; status: AcpConnectionStatus; error?: unknown }
  | { type: "connection.initialized"; response: InitializeResponse }
  | { type: "sessions.listed"; sessions: readonly SessionInfo[] }
  | { type: "session.preparing"; sessionId: string }
  | {
      type: "session.attached";
      sessionId: string;
      info?: SessionInfo;
      modes?: SessionModeState | null;
      configOptions?: readonly SessionConfigOption[] | null;
      access?: AcpSessionAccess;
    }
  | { type: "session.committed"; sessionId: string }
  | { type: "session.prepared_cleared"; sessionId: string }
  | { type: "session.selected"; sessionId: string | undefined }
  | { type: "session.deleted"; sessionId: string }
  | { type: "session.loading"; sessionId: string; clearHistory: boolean }
  | { type: "session.restored"; session: AcpSessionState; error?: unknown }
  | { type: "session.attach_failed"; sessionId: string; error: unknown }
  | { type: "session.closed"; sessionId: string }
  | {
      type: "session.config_options";
      sessionId: string;
      configOptions: readonly SessionConfigOption[];
    }
  | { type: "session.prompt_started"; sessionId: string }
  | {
      type: "session.prompt_stopped";
      sessionId: string;
      response: PromptResponse;
    }
  | { type: "session.turn_failed"; sessionId: string; error: unknown }
  | { type: "session.cancel_started"; sessionId: string }
  | { type: "session.update"; notification: SessionNotification }
  | {
      type: "message.optimistic";
      sessionId: string;
      message: AcpMessageRecord;
    }
  | {
      type: "message.optimistic_failed";
      sessionId: string;
      messageId: string;
      error: unknown;
    }
  | {
      type: "message.optimistic_confirmed";
      sessionId: string;
      messageId: string;
      protocolMessageId?: string;
      notifications?: readonly SessionNotification[];
    }
  | {
      type: "permission.requested";
      request: RequestPermissionRequest;
    }
  | {
      type: "permission.resolved";
      sessionId: string;
      toolCallId: string;
      response: RequestPermissionResponse;
    };

/** ACP-specific state and commands exposed through assistant-ui runtime extras. */
export type AcpRuntimeExtras = {
  /** Complete ACP connection and session state. */
  state: AcpThreadState;
  /** Active session derived from {@link AcpThreadState}. */
  session: AcpSessionState | undefined;
  /** Reopens the ACP transport and repeats initialization. */
  reconnect(): Promise<void>;
  /** Reloads the complete paginated ACP session list. */
  refreshSessions(): Promise<void>;
  /** Authenticates using one advertised method ID. */
  authenticate(methodId: string): Promise<void>;
  /** Logs out when supported by the agent. */
  logout(): Promise<void>;
  /** Loads or resumes a session and makes it active. */
  selectSession(sessionId: string): Promise<void>;
  /** Forces session/load again so a restricted attachment can reacquire write access. */
  reloadSession(sessionId: string): Promise<void>;
  /** Creates and selects a new ACP session. */
  createSession(): Promise<string>;
  /** Creates or restores a hidden session that becomes visible on first send. */
  prepareSession(): Promise<string>;
  /** Permanently deletes a session when supported by the agent. */
  deleteSession(sessionId: string): Promise<void>;
  /** Resumes a session when supported by the agent. */
  resumeSession(sessionId: string): Promise<void>;
  /** Closes a session when supported by the agent. */
  closeSession(sessionId: string): Promise<void>;
  /** Changes the active session mode. */
  setMode(modeId: string): Promise<void>;
  /** Changes an advertised configuration option on the active session. */
  setConfigOption(configId: string, value: string | boolean): Promise<void>;
  /** Resolves or cancels a pending tool permission. */
  replyToPermission(toolCallId: string, optionId?: string): Promise<void>;
};

/** Connection-focused value returned by {@link useAcpConnection}. */
export type AcpConnectionHookState = {
  /** Current connection lifecycle status. */
  status: AcpConnectionStatus;
  /** Latest connection failure. */
  error: unknown;
  /** Capabilities advertised by the connected agent. */
  capabilities: AgentCapabilities | undefined;
  /** Reopens and initializes the connection. */
  reconnect(): Promise<void>;
};

/** Authentication-focused value returned by {@link useAcpAuth}. */
export type AcpAuthHookState = {
  /** Methods advertised by the agent. */
  methods: readonly AuthMethod[];
  /** Whether authentication must finish before sessions can be used. */
  required: boolean;
  /** Authenticates with one advertised method. */
  authenticate(methodId: string): Promise<void>;
  /** Logs out when supported. */
  logout(): Promise<void>;
};

/** Permission-focused value returned by {@link useAcpPermissions}. */
export type AcpPermissionsHookState = {
  /** Pending permissions for the active session. */
  pending: readonly AcpPermissionRecord[];
  /** Selects an option, or cancels when `optionId` is omitted. */
  reply(toolCallId: string, optionId?: string): Promise<void>;
};

/** Options accepted by {@link useAcpRuntime} and {@link AcpThreadController}. */
export type AcpRuntimeOptions = ExternalStoreSharedOptions & {
  /** Provider identity: ACP stream factory or custom adapter. Rebuild with a React key to change. */
  connection: AcpConnectionSource;
  /** Provider identity: workspace supplied to session operations. Rebuild with a React key to change. */
  workspace: AcpWorkspace;
  /** Provider identity: host services exposed to the agent. Rebuild with a React key to change. */
  clientServices?: AcpClientServices;
  /** Provider identity: additional client capabilities. Rebuild with a React key to change. */
  clientCapabilities?: ClientCapabilities;
  /** Provider identity: application-owned interpretation of opaque ACP extensions. */
  extensions?: AcpRuntimeExtensionAdapter;
  /** Controlled ACP session ID to select after connection. */
  threadId?: string;
  /** Called when the active ACP session changes. */
  onThreadIdChange?: (threadId: string | undefined) => void;
  /** ACP session ID to restore without exposing it in visible thread lists. */
  preparedSessionId?: string;
  /** Called when a hidden prepared session is created, committed, or discarded. */
  onPreparedSessionIdChange?: (sessionId: string | undefined) => void;
  /** Receives connection and prompt failures. */
  onError?: (error: unknown) => void;
  /** Additional assistant-ui runtime adapters. */
  adapters?: RuntimeAdapters;
  /** Provider identity: ACP client info. Defaults to `react-acp` and the package version. */
  clientInfo?: { name: string; version: string };
};

/** assistant-ui runtime type returned by {@link useAcpRuntime}. */
export type AcpRuntime = AssistantRuntime;
/** assistant-ui message shape produced by ACP projection. */
export type AcpProjectedMessage = ThreadMessageLike;

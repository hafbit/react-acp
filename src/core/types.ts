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

export type MaybePromise<T> = T | Promise<T>;

export type AcpConnectionStatus =
  | "idle"
  | "connecting"
  | "auth-required"
  | "ready"
  | "error"
  | "closed";

export type AcpWorkspace = {
  cwd: string;
  mcpServers?: readonly McpServer[];
  additionalDirectories?: readonly string[];
};

export type AcpStreamFactory = (context: {
  signal: AbortSignal;
}) => MaybePromise<Stream>;

export type AcpConnectionSource =
  | { type: "stream"; createStream: AcpStreamFactory }
  | { type: "adapter"; adapter: AcpClientAdapter };

export type AcpFileSystemServices = {
  readTextFile?: (
    request: ReadTextFileRequest,
    signal: AbortSignal,
  ) => MaybePromise<ReadTextFileResponse>;
  writeTextFile?: (
    request: WriteTextFileRequest,
    signal: AbortSignal,
  ) => MaybePromise<void>;
};

export type AcpTerminalServices = {
  create: (
    request: CreateTerminalRequest,
    signal: AbortSignal,
  ) => MaybePromise<CreateTerminalResponse>;
  output: (
    request: TerminalOutputRequest,
    signal: AbortSignal,
  ) => MaybePromise<TerminalOutputResponse>;
  release: (
    request: ReleaseTerminalRequest,
    signal: AbortSignal,
  ) => MaybePromise<void>;
  waitForExit: (
    request: WaitForTerminalExitRequest,
    signal: AbortSignal,
  ) => MaybePromise<WaitForTerminalExitResponse>;
  kill: (
    request: { sessionId: SessionId; terminalId: string },
    signal: AbortSignal,
  ) => MaybePromise<void>;
};

export type AcpClientServices = {
  fileSystem?: AcpFileSystemServices;
  terminal?: AcpTerminalServices;
};

export type AcpClientHandlers = {
  sessionUpdate(notification: SessionNotification): MaybePromise<void>;
  requestPermission(
    request: RequestPermissionRequest,
    signal: AbortSignal,
  ): MaybePromise<RequestPermissionResponse>;
  readTextFile?(
    request: ReadTextFileRequest,
    signal: AbortSignal,
  ): MaybePromise<ReadTextFileResponse>;
  writeTextFile?(
    request: WriteTextFileRequest,
    signal: AbortSignal,
  ): MaybePromise<void>;
  terminal?: AcpTerminalServices;
};

export type AcpAdapterConnectOptions = {
  signal: AbortSignal;
  handlers: AcpClientHandlers;
};

export interface AcpClientConnection {
  readonly signal: AbortSignal;
  initialize(request: InitializeRequest): Promise<InitializeResponse>;
  authenticate(methodId: string): Promise<void>;
  logout(): Promise<LogoutResponse | void>;
  newSession(request: NewSessionRequest): Promise<NewSessionResponse>;
  loadSession(request: LoadSessionRequest): Promise<LoadSessionResponse>;
  listSessions(request: ListSessionsRequest): Promise<ListSessionsResponse>;
  deleteSession(sessionId: SessionId): Promise<DeleteSessionResponse | void>;
  resumeSession(request: ResumeSessionRequest): Promise<ResumeSessionResponse>;
  closeSession(sessionId: SessionId): Promise<void>;
  setSessionMode(request: SetSessionModeRequest): Promise<void>;
  setSessionConfigOption(
    request: SetSessionConfigOptionRequest,
  ): Promise<SetSessionConfigOptionResponse>;
  prompt(request: PromptRequest): Promise<PromptResponse>;
  cancel(sessionId: SessionId): Promise<void>;
  close(error?: unknown): void;
}

export interface AcpClientAdapter {
  connect(options: AcpAdapterConnectOptions): Promise<AcpClientConnection>;
}

export type AcpMessagePiece =
  | { type: "content"; content: ContentBlock; raw: SessionUpdate }
  | { type: "tool"; toolCallId: string }
  | { type: "plan"; plan: Extract<SessionUpdate, { sessionUpdate: "plan" }> }
  | { type: "unsupported"; update: SessionUpdate | unknown };

export type AcpMessageRecord = {
  id: string;
  role: "user" | "assistant";
  createdAt: number;
  pieces: readonly AcpMessagePiece[];
  status?:
    | { type: "running" }
    | { type: "complete"; stopReason: StopReason }
    | { type: "incomplete"; stopReason?: StopReason; error?: unknown };
  optimistic?: boolean;
  error?: unknown;
};

export type AcpToolCallRecord = {
  toolCallId: string;
  messageId: string;
  value: ToolCall | ToolCallUpdate;
  permission?: AcpPermissionRecord;
  rawUpdates: readonly (ToolCall | ToolCallUpdate)[];
};

export type AcpPermissionRecord = {
  request: RequestPermissionRequest;
  status: "pending" | "resolved" | "cancelled";
  response?: RequestPermissionResponse;
};

export type AcpSessionRunState =
  | "idle"
  | "loading"
  | "running"
  | "cancelling"
  | "error";

export type AcpSessionState = {
  sessionId: SessionId;
  info?: SessionInfo;
  runState: AcpSessionRunState;
  messages: readonly AcpMessageRecord[];
  tools: Readonly<Record<string, AcpToolCallRecord>>;
  permissions: Readonly<Record<string, AcpPermissionRecord>>;
  plan?: Extract<SessionUpdate, { sessionUpdate: "plan" }>;
  commands: Extract<
    SessionUpdate,
    { sessionUpdate: "available_commands_update" }
  >["availableCommands"];
  modes?: SessionModeState | null;
  configOptions: readonly SessionConfigOption[];
  usage?: UsageUpdate;
  turn: number;
  lastChunk?: { role: "user" | "assistant"; messageId: string };
  lastAssistantMessageId?: string;
  unhandledEvents: readonly unknown[];
  rawNotifications: readonly SessionNotification[];
  error?: unknown;
};

export type AcpThreadState = {
  connectionStatus: AcpConnectionStatus;
  connectionError?: unknown;
  initializeResponse?: InitializeResponse;
  capabilities?: AgentCapabilities;
  authMethods: readonly AuthMethod[];
  sessions: Readonly<Record<string, AcpSessionState>>;
  sessionOrder: readonly string[];
  activeSessionId?: string;
};

export type AcpStateEvent =
  | { type: "connection.status"; status: AcpConnectionStatus; error?: unknown }
  | { type: "connection.initialized"; response: InitializeResponse }
  | { type: "sessions.listed"; sessions: readonly SessionInfo[] }
  | {
      type: "session.opened";
      sessionId: string;
      info?: SessionInfo;
      modes?: SessionModeState | null;
      configOptions?: readonly SessionConfigOption[] | null;
      loading?: boolean;
    }
  | { type: "session.selected"; sessionId: string }
  | { type: "session.deleted"; sessionId: string }
  | { type: "session.loading"; sessionId: string }
  | { type: "session.loaded"; sessionId: string }
  | { type: "session.prompt_started"; sessionId: string }
  | {
      type: "session.prompt_stopped";
      sessionId: string;
      response: PromptResponse;
    }
  | { type: "session.failed"; sessionId: string; error: unknown }
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
      type: "permission.requested";
      request: RequestPermissionRequest;
    }
  | {
      type: "permission.resolved";
      sessionId: string;
      toolCallId: string;
      response: RequestPermissionResponse;
    };

export type AcpRuntimeExtras = {
  state: AcpThreadState;
  session: AcpSessionState | undefined;
  reconnect(): Promise<void>;
  authenticate(methodId: string): Promise<void>;
  logout(): Promise<void>;
  selectSession(sessionId: string): Promise<void>;
  createSession(): Promise<string>;
  deleteSession(sessionId: string): Promise<void>;
  resumeSession(sessionId: string): Promise<void>;
  closeSession(sessionId: string): Promise<void>;
  setMode(modeId: string): Promise<void>;
  setConfigOption(configId: string, value: string | boolean): Promise<void>;
  replyToPermission(toolCallId: string, optionId?: string): Promise<void>;
};

export type AcpConnectionHookState = {
  status: AcpConnectionStatus;
  error: unknown;
  capabilities: AgentCapabilities | undefined;
  reconnect(): Promise<void>;
};

export type AcpAuthHookState = {
  methods: readonly AuthMethod[];
  required: boolean;
  authenticate(methodId: string): Promise<void>;
  logout(): Promise<void>;
};

export type AcpPermissionsHookState = {
  pending: readonly AcpPermissionRecord[];
  reply(toolCallId: string, optionId?: string): Promise<void>;
};

export type AcpRuntimeOptions = ExternalStoreSharedOptions & {
  connection: AcpConnectionSource;
  workspace: AcpWorkspace;
  clientServices?: AcpClientServices;
  clientCapabilities?: ClientCapabilities;
  threadId?: string;
  onThreadIdChange?: (threadId: string | undefined) => void;
  onError?: (error: unknown) => void;
  adapters?: RuntimeAdapters;
  clientInfo?: { name: string; version: string };
};

export type AcpRuntime = AssistantRuntime;
export type AcpProjectedMessage = ThreadMessageLike;

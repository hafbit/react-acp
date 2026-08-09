import type {
  AgentCapabilities,
  SessionUpdate,
  StopReason,
  ToolCall,
  ToolCallUpdate,
} from "@agentclientprotocol/sdk";
import type {
  AcpMessagePiece,
  AcpMessageRecord,
  AcpSessionState,
  AcpStateEvent,
  AcpThreadState,
  AcpToolCallRecord,
} from "./types";

/** Creates the empty, disconnected ACP thread repository. */
export const createAcpThreadState = (): AcpThreadState => ({
  connectionStatus: "idle",
  authMethods: [],
  sessions: {},
  sessionOrder: [],
});

/** Creates empty protocol-authoritative state for an ACP session ID. */
export const createAcpSessionState = (sessionId: string): AcpSessionState => ({
  sessionId,
  runState: "idle",
  messages: [],
  tools: {},
  permissions: {},
  commands: [],
  configOptions: [],
  turn: 0,
  unhandledEvents: [],
  rawNotifications: [],
});

const updateSession = (
  state: AcpThreadState,
  sessionId: string,
  update: (session: AcpSessionState) => AcpSessionState,
): AcpThreadState => {
  const current = state.sessions[sessionId] ?? createAcpSessionState(sessionId);
  return {
    ...state,
    sessions: { ...state.sessions, [sessionId]: update(current) },
    sessionOrder: state.sessionOrder.includes(sessionId)
      ? state.sessionOrder
      : [...state.sessionOrder, sessionId],
  };
};

const appendMessage = (session: AcpSessionState, message: AcpMessageRecord): AcpSessionState => ({
  ...session,
  messages: [...session.messages, message],
});

const patchMessage = (
  session: AcpSessionState,
  messageId: string,
  patch: (message: AcpMessageRecord) => AcpMessageRecord,
): AcpSessionState => ({
  ...session,
  messages: session.messages.map((message) =>
    message.id === messageId ? patch(message) : message,
  ),
});

const localMessageId = (session: AcpSessionState, role: "user" | "assistant") =>
  `${session.sessionId}:turn:${session.turn}:${role}:${session.messages.length}`;

const ensureMessage = (
  session: AcpSessionState,
  role: "user" | "assistant",
  protocolMessageId?: string | null,
): [AcpSessionState, string] => {
  const exactId = protocolMessageId ?? undefined;
  if (exactId && session.messages.some((message) => message.id === exactId)) {
    return [session, exactId];
  }

  if (!exactId && session.lastChunk?.role === role) {
    return [session, session.lastChunk.messageId];
  }

  const messageId = exactId ?? localMessageId(session, role);
  const next = appendMessage(session, {
    id: messageId,
    role,
    createdAt: Date.now(),
    pieces: [],
    ...(role === "assistant" ? { status: { type: "running" } } : {}),
  });
  return [
    {
      ...next,
      lastChunk: { role, messageId },
      ...(role === "assistant" ? { lastAssistantMessageId: messageId } : {}),
    },
    messageId,
  ];
};

const appendPiece = (session: AcpSessionState, messageId: string, piece: AcpMessagePiece) =>
  patchMessage(session, messageId, (message) => ({
    ...message,
    pieces: [...message.pieces, piece],
  }));

const mergeTool = (
  existing: AcpToolCallRecord | undefined,
  incoming: ToolCall | ToolCallUpdate,
  messageId: string,
): AcpToolCallRecord => {
  const value = existing ? { ...existing.value, ...incoming } : incoming;
  return {
    toolCallId: incoming.toolCallId,
    messageId,
    value,
    ...(existing?.permission ? { permission: existing.permission } : {}),
    rawUpdates: [...(existing?.rawUpdates ?? []), incoming],
  };
};

const reduceUpdate = (session: AcpSessionState, update: SessionUpdate): AcpSessionState => {
  switch (update.sessionUpdate) {
    case "user_message_chunk":
    case "agent_message_chunk":
    case "agent_thought_chunk": {
      const role = update.sessionUpdate === "user_message_chunk" ? "user" : "assistant";
      const [withMessage, messageId] = ensureMessage(session, role, update.messageId);
      return appendPiece(withMessage, messageId, {
        type: "content",
        content: update.content,
        raw: update,
      });
    }
    case "tool_call":
    case "tool_call_update": {
      let current = session;
      let messageId = session.tools[update.toolCallId]?.messageId ?? session.lastAssistantMessageId;
      if (!messageId) {
        [current, messageId] = ensureMessage(session, "assistant");
      }
      const exists = current.tools[update.toolCallId];
      const nextTools = {
        ...current.tools,
        [update.toolCallId]: mergeTool(exists, update, messageId),
      };
      const alreadyLinked = current.messages
        .find((message) => message.id === messageId)
        ?.pieces.some((piece) => piece.type === "tool" && piece.toolCallId === update.toolCallId);
      const linked = alreadyLinked
        ? current
        : appendPiece(current, messageId, {
            type: "tool",
            toolCallId: update.toolCallId,
          });
      return { ...linked, tools: nextTools, lastAssistantMessageId: messageId };
    }
    case "plan": {
      let current = session;
      let messageId = session.lastAssistantMessageId;
      if (!messageId) [current, messageId] = ensureMessage(session, "assistant");
      return {
        ...appendPiece(current, messageId, { type: "plan", plan: update }),
        plan: update,
      };
    }
    case "available_commands_update":
      return { ...session, commands: update.availableCommands };
    case "current_mode_update":
      return session.modes
        ? {
            ...session,
            modes: { ...session.modes, currentModeId: update.currentModeId },
          }
        : session;
    case "config_option_update":
      return { ...session, configOptions: update.configOptions };
    case "session_info_update":
      return {
        ...session,
        info: {
          sessionId: session.sessionId,
          cwd: session.info?.cwd ?? "",
          ...session.info,
          ...(update.title !== undefined ? { title: update.title } : {}),
          ...(update.updatedAt !== undefined ? { updatedAt: update.updatedAt } : {}),
        },
      };
    case "usage_update":
      return { ...session, usage: update };
    default: {
      let current = session;
      let messageId = session.lastAssistantMessageId;
      if (!messageId) [current, messageId] = ensureMessage(session, "assistant");
      return {
        ...appendPiece(current, messageId, { type: "unsupported", update }),
        unhandledEvents: [...current.unhandledEvents, update],
      };
    }
  }
};

const statusFromStopReason = (stopReason: StopReason): AcpMessageRecord["status"] =>
  stopReason === "end_turn" ? { type: "complete", stopReason } : { type: "incomplete", stopReason };

const finalizeAssistantMessage = (
  session: AcpSessionState,
  stopReason: StopReason,
): AcpSessionState => {
  if (!session.lastAssistantMessageId) return session;
  return patchMessage(session, session.lastAssistantMessageId, (message) => ({
    ...message,
    status: statusFromStopReason(stopReason),
  }));
};

/**
 * Applies one connection, session, message, tool, or permission event.
 *
 * The reducer is pure apart from locally generated message timestamps and is
 * suitable for deterministic projection tests with controlled time.
 */
export function reduceAcpThreadState(state: AcpThreadState, event: AcpStateEvent): AcpThreadState {
  switch (event.type) {
    case "connection.status":
      return {
        ...state,
        connectionStatus: event.status,
        ...(event.error !== undefined ? { connectionError: event.error } : {}),
      };
    case "connection.initialized":
      return {
        ...state,
        initializeResponse: event.response,
        capabilities: event.response.agentCapabilities,
        authMethods: event.response.authMethods ?? [],
        connectionStatus: (event.response.authMethods?.length ?? 0) > 0 ? "auth-required" : "ready",
      };
    case "sessions.listed": {
      let next = state;
      for (const info of event.sessions) {
        next = updateSession(next, info.sessionId, (session) => ({
          ...session,
          info,
        }));
      }
      return next;
    }
    case "session.opened":
      return {
        ...updateSession(state, event.sessionId, (session) => ({
          ...session,
          ...(event.info ? { info: event.info } : {}),
          ...(event.modes !== undefined ? { modes: event.modes } : {}),
          configOptions: event.configOptions ?? session.configOptions,
          runState: event.loading ? "loading" : "idle",
        })),
        activeSessionId: event.sessionId,
      };
    case "session.selected":
      return { ...state, activeSessionId: event.sessionId };
    case "session.deleted": {
      const sessions = { ...state.sessions };
      delete sessions[event.sessionId];
      return {
        ...state,
        sessions,
        sessionOrder: state.sessionOrder.filter((id) => id !== event.sessionId),
        ...(state.activeSessionId === event.sessionId ? { activeSessionId: undefined } : {}),
      };
    }
    case "session.loading":
      return updateSession(state, event.sessionId, (session) => ({
        ...createAcpSessionState(event.sessionId),
        info: session.info,
        runState: "loading",
      }));
    case "session.loaded":
      return updateSession(state, event.sessionId, (session) => ({
        ...session,
        runState: "idle",
      }));
    case "session.prompt_started":
      return updateSession(state, event.sessionId, (session) => ({
        ...session,
        runState: "running",
        turn: session.turn + 1,
        lastChunk: undefined,
        error: undefined,
      }));
    case "session.prompt_stopped":
      return updateSession(state, event.sessionId, (session) => ({
        ...finalizeAssistantMessage(session, event.response.stopReason),
        runState: "idle",
        lastChunk: undefined,
      }));
    case "session.failed":
      return updateSession(state, event.sessionId, (session) => ({
        ...session,
        runState: "error",
        error: event.error,
      }));
    case "session.cancel_started":
      return updateSession(state, event.sessionId, (session) => ({
        ...session,
        runState: "cancelling",
      }));
    case "session.update":
      return updateSession(state, event.notification.sessionId, (session) => ({
        ...reduceUpdate(session, event.notification.update),
        rawNotifications: [...session.rawNotifications, event.notification],
      }));
    case "message.optimistic":
      return updateSession(state, event.sessionId, (session) =>
        appendMessage(session, event.message),
      );
    case "message.optimistic_failed":
      return updateSession(state, event.sessionId, (session) =>
        patchMessage(session, event.messageId, (message) => ({
          ...message,
          error: event.error,
          optimistic: false,
        })),
      );
    case "permission.requested":
      return updateSession(state, event.request.sessionId, (session) => {
        const record = { request: event.request, status: "pending" as const };
        let current = session;
        let messageId = session.lastAssistantMessageId;
        if (!messageId) [current, messageId] = ensureMessage(session, "assistant");
        const toolCallId = event.request.toolCall.toolCallId;
        const existing = current.tools[toolCallId];
        const tool = mergeTool(existing, event.request.toolCall, messageId);
        const alreadyLinked = current.messages
          .find((message) => message.id === messageId)
          ?.pieces.some((piece) => piece.type === "tool" && piece.toolCallId === toolCallId);
        if (!alreadyLinked) {
          current = appendPiece(current, messageId, {
            type: "tool",
            toolCallId,
          });
        }
        return {
          ...current,
          permissions: {
            ...current.permissions,
            [toolCallId]: record,
          },
          tools: {
            ...current.tools,
            [toolCallId]: { ...tool, permission: record },
          },
          lastAssistantMessageId: messageId,
        };
      });
    case "permission.resolved":
      return updateSession(state, event.sessionId, (session) => {
        const current = session.permissions[event.toolCallId];
        if (!current) return session;
        const permission = {
          ...current,
          status:
            event.response.outcome.outcome === "cancelled"
              ? ("cancelled" as const)
              : ("resolved" as const),
          response: event.response,
        };
        const tool = session.tools[event.toolCallId];
        return {
          ...session,
          permissions: {
            ...session.permissions,
            [event.toolCallId]: permission,
          },
          tools: tool
            ? {
                ...session.tools,
                [event.toolCallId]: { ...tool, permission },
              }
            : session.tools,
        };
      });
  }
}

/** Tests whether an optional stable ACP session or auth capability is advertised. */
export const hasAgentCapability = (
  capabilities: AgentCapabilities | undefined,
  capability: "load" | "list" | "delete" | "resume" | "close" | "logout",
): boolean => {
  switch (capability) {
    case "load":
      return capabilities?.loadSession === true;
    case "list":
      return capabilities?.sessionCapabilities?.list != null;
    case "delete":
      return capabilities?.sessionCapabilities?.delete != null;
    case "resume":
      return capabilities?.sessionCapabilities?.resume != null;
    case "close":
      return capabilities?.sessionCapabilities?.close != null;
    case "logout":
      return capabilities?.auth?.logout != null;
  }
};

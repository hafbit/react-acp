import type {
  AgentCapabilities,
  SessionNotification,
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
  access: { mode: "read-write" },
  messages: [],
  tools: {},
  permissions: {},
  commands: [],
  configOptions: [],
  turn: 0,
  latestNotifications: {},
  unhandledNotifications: [],
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
    sessionOrder: state.preparedSessionId === sessionId
      ? state.sessionOrder.filter((id) => id !== sessionId)
      : state.sessionOrder.includes(sessionId)
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
  const exactMessage = exactId
    ? session.messages.find(
        (message) => message.id === exactId || message.protocolMessageId === exactId,
      )
    : undefined;
  if (exactMessage) return [session, exactMessage.id];

  if (!exactId && session.lastChunk?.role === role) {
    return [session, session.lastChunk.messageId];
  }

  const messageId = exactId ?? localMessageId(session, role);
  const next = appendMessage(session, {
    id: messageId,
    ...(exactId ? { protocolMessageId: exactId } : {}),
    role,
    createdAt: Date.now(),
    pieces: [],
    rawNotifications: [],
    ...(role === "assistant" ? { status: { type: "running" } } : {}),
  });
  return [
    {
      ...next,
      lastChunk: { role, messageId },
      lastAssistantMessageId: role === "assistant" ? messageId : undefined,
    },
    messageId,
  ];
};

const appendPiece = (session: AcpSessionState, messageId: string, piece: AcpMessagePiece) =>
  patchMessage(session, messageId, (message) => ({
    ...message,
    pieces: [...message.pieces, piece],
  }));

const appendMessageNotification = (
  session: AcpSessionState,
  messageId: string,
  notification: SessionNotification,
) =>
  patchMessage(session, messageId, (message) => ({
    ...message,
    rawNotifications: [...message.rawNotifications, notification],
  }));

const mergeTool = (
  existing: AcpToolCallRecord | undefined,
  incoming: ToolCall | ToolCallUpdate,
  messageId: string,
  notification?: SessionNotification,
): AcpToolCallRecord => {
  const value = existing ? { ...existing.value, ...incoming } : incoming;
  return {
    toolCallId: incoming.toolCallId,
    messageId,
    value,
    ...(existing?.permission ? { permission: existing.permission } : {}),
    rawNotifications: notification
      ? [...(existing?.rawNotifications ?? []), notification]
      : (existing?.rawNotifications ?? []),
  };
};

const recordLatestNotification = (
  session: AcpSessionState,
  notification: SessionNotification,
): AcpSessionState => ({
  ...session,
  latestNotifications: {
    ...session.latestNotifications,
    [notification.update.sessionUpdate]: notification,
  },
});

const reduceNotification = (
  session: AcpSessionState,
  notification: SessionNotification,
): AcpSessionState => {
  const update = notification.update;
  switch (update.sessionUpdate) {
    case "user_message_chunk":
    case "agent_message_chunk":
    case "agent_thought_chunk": {
      const role = update.sessionUpdate === "user_message_chunk" ? "user" : "assistant";
      const [withMessage, messageId] = ensureMessage(session, role, update.messageId);
      const withPiece = appendPiece(withMessage, messageId, {
        type: "content",
        content: update.content,
        notification,
      });
      return appendMessageNotification(withPiece, messageId, notification);
    }
    case "tool_call":
    case "tool_call_update": {
      let current = session;
      let messageId = session.tools[update.toolCallId]?.messageId ?? session.lastAssistantMessageId;
      if (!messageId) [current, messageId] = ensureMessage(session, "assistant");
      const existing = current.tools[update.toolCallId];
      const nextTools = {
        ...current.tools,
        [update.toolCallId]: mergeTool(existing, update, messageId, notification),
      };
      const alreadyLinked = current.messages
        .find((message) => message.id === messageId)
        ?.pieces.some((piece) => piece.type === "tool" && piece.toolCallId === update.toolCallId);
      const linked = alreadyLinked
        ? current
        : appendPiece(current, messageId, { type: "tool", toolCallId: update.toolCallId });
      return { ...linked, tools: nextTools, lastAssistantMessageId: messageId };
    }
    case "plan": {
      let current = session;
      let messageId = session.lastAssistantMessageId;
      if (!messageId) [current, messageId] = ensureMessage(session, "assistant");
      const withPlan = appendPiece(current, messageId, {
        type: "plan",
        plan: update,
        notification,
      });
      return recordLatestNotification(
        appendMessageNotification({ ...withPlan, plan: update }, messageId, notification),
        notification,
      );
    }
    case "available_commands_update":
      return recordLatestNotification(
        { ...session, commands: update.availableCommands },
        notification,
      );
    case "current_mode_update":
      return recordLatestNotification(
        session.modes
          ? { ...session, modes: { ...session.modes, currentModeId: update.currentModeId } }
          : session,
        notification,
      );
    case "config_option_update":
      return recordLatestNotification(
        { ...session, configOptions: update.configOptions },
        notification,
      );
    case "session_info_update":
      return recordLatestNotification(
        {
          ...session,
          info: {
            sessionId: session.sessionId,
            cwd: session.info?.cwd ?? "",
            ...session.info,
            ...(update.title !== undefined ? { title: update.title ?? undefined } : {}),
            ...(update.updatedAt !== undefined ? { updatedAt: update.updatedAt ?? undefined } : {}),
          },
        },
        notification,
      );
    case "usage_update":
      return recordLatestNotification({ ...session, usage: update }, notification);
    default: {
      let current = session;
      let messageId = session.lastAssistantMessageId;
      if (!messageId) [current, messageId] = ensureMessage(session, "assistant");
      const withUnsupported = appendPiece(current, messageId, {
        type: "unsupported",
        notification,
      });
      return {
        ...appendMessageNotification(withUnsupported, messageId, notification),
        unhandledNotifications: [...current.unhandledNotifications, notification],
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

/** Applies one connection, session, message, tool, or permission event. */
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
        connectionStatus: (event.response.authMethods?.length ?? 0) > 0 ? "connecting" : "ready",
      };
    case "sessions.listed": {
      const sessions: Record<string, AcpSessionState> = {};
      for (const info of event.sessions) {
        sessions[info.sessionId] = {
          ...(state.sessions[info.sessionId] ?? createAcpSessionState(info.sessionId)),
          info,
        };
      }
      const active = state.activeSessionId;
      if (active && !sessions[active] && state.sessions[active])
        sessions[active] = state.sessions[active];
      const listedOrder = event.sessions
        .map((info) => info.sessionId)
        .filter((sessionId) => sessionId !== state.preparedSessionId);
      return {
        ...state,
        sessions,
        sessionOrder:
          active && active !== state.preparedSessionId && !listedOrder.includes(active)
            ? [...listedOrder, active]
            : listedOrder,
      };
    }
    case "session.preparing": {
      const prepared = {
        ...state,
        preparedSessionId: event.sessionId,
        sessionOrder: state.sessionOrder.filter((id) => id !== event.sessionId),
      };
      return updateSession(prepared, event.sessionId, (session) => session);
    }
    case "session.attached":
      return updateSession(state, event.sessionId, (session) => ({
        ...session,
        ...(event.info ? { info: event.info } : {}),
        ...(event.modes !== undefined ? { modes: event.modes } : {}),
        access: event.access ?? { mode: "read-write" },
        configOptions: event.configOptions ?? session.configOptions,
        runState: "idle",
        error: undefined,
      }));
    case "session.committed":
      return {
        ...state,
        preparedSessionId:
          state.preparedSessionId === event.sessionId ? undefined : state.preparedSessionId,
        sessionOrder: state.sessionOrder.includes(event.sessionId)
          ? state.sessionOrder
          : [...state.sessionOrder, event.sessionId],
      };
    case "session.prepared_cleared":
      if (state.preparedSessionId !== event.sessionId) return state;
      const remainingSessions = { ...state.sessions };
      delete remainingSessions[event.sessionId];
      return {
        ...state,
        sessions: remainingSessions,
        preparedSessionId: undefined,
        sessionOrder: state.sessionOrder.filter((id) => id !== event.sessionId),
        ...(state.activeSessionId === event.sessionId ? { activeSessionId: undefined } : {}),
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
        ...(state.preparedSessionId === event.sessionId ? { preparedSessionId: undefined } : {}),
        ...(state.activeSessionId === event.sessionId ? { activeSessionId: undefined } : {}),
      };
    }
    case "session.loading":
      return updateSession(state, event.sessionId, (session) => ({
        ...(event.clearHistory
          ? { ...createAcpSessionState(event.sessionId), info: session.info }
          : session),
        runState: "loading",
        error: undefined,
      }));
    case "session.restored":
      return updateSession(state, event.session.sessionId, () => ({
        ...event.session,
        ...(event.error !== undefined ? { runState: "error", error: event.error } : {}),
      }));
    case "session.attach_failed":
      return updateSession(state, event.sessionId, (session) => ({
        ...session,
        runState: "error",
        error: event.error,
      }));
    case "session.closed":
      return updateSession(state, event.sessionId, (session) => ({
        ...session,
        runState: "idle",
        error: undefined,
      }));
    case "session.config_options":
      return updateSession(state, event.sessionId, (session) => ({
        ...session,
        configOptions: event.configOptions,
      }));
    case "session.prompt_started":
      return updateSession(state, event.sessionId, (session) => ({
        ...session,
        runState: "running",
        turn: session.turn + 1,
        lastChunk: undefined,
        lastAssistantMessageId: undefined,
        error: undefined,
      }));
    case "session.prompt_stopped":
      return updateSession(state, event.sessionId, (session) => ({
        ...finalizeAssistantMessage(session, event.response.stopReason),
        runState: "idle",
        lastChunk: undefined,
      }));
    case "session.turn_failed":
      return updateSession(state, event.sessionId, (session) => ({
        ...session,
        runState: "idle",
        error: event.error,
      }));
    case "session.cancel_started":
      return updateSession(state, event.sessionId, (session) => ({
        ...session,
        runState: "cancelling",
      }));
    case "session.update":
      return updateSession(state, event.notification.sessionId, (session) =>
        reduceNotification(session, event.notification),
      );
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
    case "message.optimistic_confirmed":
      return updateSession(state, event.sessionId, (session) =>
        patchMessage(session, event.messageId, (message) => ({
          ...message,
          optimistic: false,
          ...(event.protocolMessageId ? { protocolMessageId: event.protocolMessageId } : {}),
          rawNotifications: [...message.rawNotifications, ...(event.notifications ?? [])],
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
        if (!alreadyLinked) current = appendPiece(current, messageId, { type: "tool", toolCallId });
        return {
          ...current,
          permissions: { ...current.permissions, [toolCallId]: record },
          tools: { ...current.tools, [toolCallId]: { ...tool, permission: record } },
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
          permissions: { ...session.permissions, [event.toolCallId]: permission },
          tools: tool
            ? { ...session.tools, [event.toolCallId]: { ...tool, permission } }
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

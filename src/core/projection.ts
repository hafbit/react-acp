import { ExportedMessageRepository } from "@assistant-ui/react";
import type { ContentBlock, PermissionOptionKind, ToolCallContent } from "@agentclientprotocol/sdk";
import { errorMessage } from "./internal-errors";
import type {
  AcpMessagePiece,
  AcpMessageRecord,
  AcpProjectedMessage,
  AcpRuntimeExtensionAdapter,
  AcpSessionState,
  AcpThreadState,
  AcpToolCallRecord,
} from "./types";

type ProjectedPart = Exclude<AcpProjectedMessage["content"], string>[number];
type ProjectionExtensions = Pick<AcpRuntimeExtensionAdapter, "messagePhase"> | undefined;

const dataPart = (name: string, data: unknown): ProjectedPart => ({
  type: "data",
  name,
  data,
});

const toDataUrl = (mimeType: string, data: string) => `data:${mimeType};base64,${data}`;

const piecePhase = (
  piece: AcpMessagePiece,
  extensions: ProjectionExtensions,
): string | undefined => {
  if (piece.type !== "content") return undefined;
  return piece.notification ? extensions?.messagePhase?.(piece.notification) : undefined;
};

function projectContent(content: ContentBlock, reasoning: boolean): ProjectedPart {
  switch (content.type) {
    case "text":
      return reasoning
        ? { type: "reasoning", text: content.text }
        : { type: "text", text: content.text };
    case "image":
      return {
        type: "image",
        image: content.uri ?? toDataUrl(content.mimeType, content.data),
      };
    case "audio":
      return {
        type: "file",
        filename: "audio",
        data: content.data,
        mimeType: content.mimeType,
      };
    case "resource_link":
      return /^https?:\/\//i.test(content.uri)
        ? {
            type: "source",
            sourceType: "url",
            id: content.uri,
            url: content.uri,
            title: content.title ?? content.name,
          }
        : dataPart("acp-resource-link", content);
    case "resource":
      return "blob" in content.resource
        ? {
            type: "file",
            filename: content.resource.uri,
            data: content.resource.blob,
            mimeType: content.resource.mimeType ?? "application/octet-stream",
          }
        : dataPart("acp-resource", content);
    default:
      return dataPart("acp-unsupported", {
        reason: "unknown-content-block",
        content,
      });
  }
}

const approvalKind = (kind: PermissionOptionKind) =>
  kind.replaceAll("_", "-") as "allow-once" | "allow-always" | "reject-once" | "reject-always";

const projectToolApproval = (tool: AcpToolCallRecord) => {
  const permission = tool.permission;
  if (!permission) return undefined;

  const options = permission.request.options.map((option) => ({
    id: option.optionId,
    kind: approvalKind(option.kind),
    label: option.name,
  }));

  if (permission.status === "pending") {
    return { id: tool.toolCallId, options };
  }

  if (permission.status === "cancelled" || permission.response?.outcome.outcome === "cancelled") {
    return { id: tool.toolCallId, options, resolution: "cancelled" as const };
  }

  const optionId =
    permission.response?.outcome.outcome === "selected"
      ? permission.response.outcome.optionId
      : undefined;
  const selected = permission.request.options.find((option) => option.optionId === optionId);
  return {
    id: tool.toolCallId,
    options,
    optionId,
    approved: selected?.kind.startsWith("allow") ?? false,
  };
};

const normalizeObject = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : value === undefined
      ? {}
      : { value };

const normalizeToolContent = (content: readonly ToolCallContent[] | null | undefined) =>
  content?.map((part) => {
    if (part.type === "diff") return { ...part, type: "diff" };
    if (part.type === "terminal") return { ...part, type: "terminal" };
    return { type: "content", content: part.content };
  });

function projectTool(tool: AcpToolCallRecord): ProjectedPart {
  const value = tool.value;
  const status = value.status;
  const rawInput = value.rawInput;
  const rawOutput = value.rawOutput;
  const args = normalizeObject(rawInput);
  const content = normalizeToolContent(value.content);
  const result =
    rawOutput !== undefined
      ? rawOutput
      : status === "completed" || status === "failed"
        ? content
        : undefined;
  const kind = value.kind ?? "other";

  return {
    type: "tool-call",
    toolCallId: tool.toolCallId,
    toolName: `acp:${kind}`,
    args: args as never,
    argsText: JSON.stringify(args),
    ...(result !== undefined ? { result } : {}),
    ...(status === "failed" ? { isError: true } : {}),
    artifact: {
      acp: {
        title: value.title,
        kind,
        status,
        content,
        locations: value.locations,
        rawInput,
        rawOutput,
        rawNotifications: tool.rawNotifications,
      },
    },
    ...(projectToolApproval(tool) ? { approval: projectToolApproval(tool) } : {}),
  };
}

const projectPiece = (
  session: AcpSessionState,
  messageId: string,
  piece: AcpMessagePiece,
  rawPieceIndex: number,
  phase: string | undefined,
): ProjectedPart => {
  switch (piece.type) {
    case "content": {
      const projected = projectContent(
        piece.content,
        piece.notification?.update.sessionUpdate === "agent_thought_chunk",
      );
      if (projected.type !== "text" && projected.type !== "reasoning") return projected;
      return {
        ...projected,
        providerMetadata: {
          ...projected.providerMetadata,
          acp: {
            phase: phase ?? null,
            rawPieceIndices: [rawPieceIndex],
            rawPieceRefs: [{ messageId, pieceIndex: rawPieceIndex }],
          },
        },
      };
    }
    case "tool": {
      const tool = session.tools[piece.toolCallId];
      return tool
        ? projectTool(tool)
        : dataPart("acp-unsupported", {
            reason: "missing-tool-call",
            toolCallId: piece.toolCallId,
          });
    }
    case "plan":
      return dataPart("acp-plan", piece.plan);
    case "unsupported":
      return dataPart("acp-unsupported", piece.notification.update);
  }
};

const projectMessagePieces = (
  session: AcpSessionState,
  messages: readonly AcpMessageRecord[],
  extensions: ProjectionExtensions,
): ProjectedPart[] => {
  const projected: ProjectedPart[] = [];
  let pending:
    | {
        type: "text" | "reasoning";
        phase: string | null;
        text: string[];
        rawPieceIndices: number[];
        rawPieceRefs: Array<{ messageId: string; pieceIndex: number }>;
      }
    | undefined;
  const flushPending = () => {
    if (!pending) return;
    projected.push({
      type: pending.type,
      text: pending.text.join(""),
      providerMetadata: {
        acp: {
          phase: pending.phase,
          rawPieceIndices: pending.rawPieceIndices,
          rawPieceRefs: pending.rawPieceRefs,
        },
      },
    });
    pending = undefined;
  };

  for (const message of messages) {
    let activeType: "text" | "reasoning" | undefined;
    let activePhase: string | undefined;
    for (const [rawPieceIndex, piece] of message.pieces.entries()) {
      const content = piece.type === "content" ? piece.content : undefined;
      const type =
        content?.type === "text"
          ? piece.type === "content" &&
            piece.notification?.update.sessionUpdate === "agent_thought_chunk"
            ? "reasoning"
            : "text"
          : undefined;
      if (!type) {
        activeType = undefined;
        activePhase = undefined;
      } else {
        if (activeType !== type) activePhase = undefined;
        activeType = type;
        activePhase = piecePhase(piece, extensions) ?? activePhase;
      }

      if (message.role === "assistant" && type && content?.type === "text") {
        const phase = activePhase ?? null;
        if (!pending || pending.type !== type || pending.phase !== phase) {
          flushPending();
          pending = {
            type,
            phase,
            text: [],
            rawPieceIndices: [],
            rawPieceRefs: [],
          };
        }
        pending.text.push(content.text);
        pending.rawPieceIndices.push(rawPieceIndex);
        pending.rawPieceRefs.push({ messageId: message.id, pieceIndex: rawPieceIndex });
        continue;
      }

      flushPending();
      const next = projectPiece(session, message.id, piece, rawPieceIndex, activePhase);
      projected.push(next);
    }
  }
  flushPending();
  return projected;
};

const statusForMessage = (message: AcpMessageRecord) => {
  if (message.role !== "assistant") return undefined;
  const status = message.status;
  if (!status || status.type === "running") return { type: "running" as const };
  if (status.type === "complete") {
    return { type: "complete" as const, reason: "stop" as const };
  }
  switch (status.stopReason) {
    case "max_tokens":
      return { type: "incomplete" as const, reason: "length" as const };
    case "cancelled":
      return { type: "incomplete" as const, reason: "cancelled" as const };
    default:
      return {
        type: "incomplete" as const,
        reason: status.error ? ("error" as const) : ("other" as const),
        ...(status.error ? { error: errorMessage(status.error) } : {}),
      };
  }
};

const projectMessage = (
  session: AcpSessionState,
  messages: readonly [AcpMessageRecord, ...AcpMessageRecord[]],
  extensions: ProjectionExtensions,
): AcpProjectedMessage => {
  const message = messages[0];
  const latest = messages.at(-1) ?? message;
  const messageIds = messages.map((candidate) => candidate.id);
  const protocolMessageIds = [
    ...new Set(
      messages.flatMap((candidate) =>
        candidate.protocolMessageId ? [candidate.protocolMessageId] : [],
      ),
    ),
  ];
  let latestError: unknown;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const candidate = messages[index];
    if (candidate?.error === undefined) continue;
    latestError = candidate.error;
    break;
  }
  return {
    id: message.id,
    role: message.role,
    createdAt: new Date(message.createdAt),
    content: projectMessagePieces(session, messages, extensions),
    ...(statusForMessage(latest) ? { status: statusForMessage(latest) } : {}),
    metadata: {
      isOptimistic: messages.some((candidate) => candidate.optimistic),
      custom: {
        acp: {
          sessionId: session.sessionId,
          protocolMessageId: message.protocolMessageId,
          messageIds,
          protocolMessageIds,
          notifications: messages.flatMap((candidate) => candidate.rawNotifications),
          stopReason:
            latest.status?.type === "complete" || latest.status?.type === "incomplete"
              ? latest.status.stopReason
              : undefined,
          error: latestError ? errorMessage(latestError) : undefined,
        },
      },
    },
  };
};

type ProjectionCacheEntry = {
  messages: readonly AcpMessageRecord[];
  tools: readonly (AcpToolCallRecord | undefined)[];
  projected: AcpProjectedMessage;
};

const sameReferences = <T>(left: readonly T[], right: readonly T[]): boolean =>
  left.length === right.length && left.every((value, index) => value === right[index]);

const referencedTools = (
  session: AcpSessionState,
  messages: readonly AcpMessageRecord[],
): Array<AcpToolCallRecord | undefined> =>
  messages.flatMap((message) =>
    message.pieces.flatMap((piece) =>
      piece.type === "tool" ? [session.tools[piece.toolCallId]] : [],
    ),
  );

/** Reuses projections for unchanged message groups within one active session. */
export class AcpProjectionCache {
  private entries = new Map<string, ProjectionCacheEntry>();
  private extensions: ProjectionExtensions = undefined;

  begin(extensions: ProjectionExtensions): void {
    if (this.extensions === extensions) return;
    this.entries.clear();
    this.extensions = extensions;
  }

  project(
    session: AcpSessionState,
    messages: readonly [AcpMessageRecord, ...AcpMessageRecord[]],
    extensions: ProjectionExtensions,
  ): AcpProjectedMessage {
    const key = messages[0].id;
    const tools = referencedTools(session, messages);
    const cached = this.entries.get(key);
    if (
      cached &&
      sameReferences(cached.messages, messages) &&
      sameReferences(cached.tools, tools)
    ) {
      return cached.projected;
    }
    const projected = projectMessage(session, messages, extensions);
    this.entries.set(key, { messages: [...messages], tools, projected });
    return projected;
  }

  retain(keys: ReadonlySet<string>): void {
    for (const key of this.entries.keys()) {
      if (!keys.has(key)) this.entries.delete(key);
    }
  }
}

/** Projects one already-resolved ACP session into assistant-ui messages. */
export function projectAcpSessionMessages(
  session: AcpSessionState | undefined,
  extensions?: ProjectionExtensions,
  cache?: AcpProjectionCache,
): AcpProjectedMessage[] {
  if (!session) return [];
  cache?.begin(extensions);
  const projected: AcpProjectedMessage[] = [];
  const retainedKeys = new Set<string>();
  for (let index = 0; index < session.messages.length;) {
    const message = session.messages[index];
    if (!message) break;
    if (message.role === "user") {
      retainedKeys.add(message.id);
      projected.push(
        cache?.project(session, [message], extensions) ??
          projectMessage(session, [message], extensions),
      );
      index += 1;
      continue;
    }

    const assistantMessages: [AcpMessageRecord, ...AcpMessageRecord[]] = [message];
    let nextIndex = index + 1;
    while (session.messages[nextIndex]?.role === "assistant") {
      assistantMessages.push(session.messages[nextIndex] as AcpMessageRecord);
      nextIndex += 1;
    }
    retainedKeys.add(message.id);
    projected.push(
      cache?.project(session, assistantMessages, extensions) ??
        projectMessage(session, assistantMessages, extensions),
    );
    index = nextIndex;
  }
  cache?.retain(retainedKeys);
  return projected;
}

/** Projects one already-resolved ACP session into an exported repository. */
export function projectAcpSessionRepository(
  session: AcpSessionState | undefined,
  extensions?: ProjectionExtensions,
  cache?: AcpProjectionCache,
): ExportedMessageRepository {
  return ExportedMessageRepository.fromArray(projectAcpSessionMessages(session, extensions, cache));
}

/** Projects one ACP session into assistant-ui thread messages. */
export function projectAcpThreadMessages(
  state: AcpThreadState,
  sessionId = state.activeSessionId,
  extensions?: Pick<AcpRuntimeExtensionAdapter, "messagePhase">,
): AcpProjectedMessage[] {
  if (!sessionId) return [];
  return projectAcpSessionMessages(state.sessions[sessionId], extensions);
}

/** Projects all ACP sessions into an assistant-ui exported message repository. */
export function projectAcpThreadRepository(
  state: AcpThreadState,
  sessionId = state.activeSessionId,
  extensions?: Pick<AcpRuntimeExtensionAdapter, "messagePhase">,
): ExportedMessageRepository {
  if (!sessionId) return ExportedMessageRepository.fromArray([]);
  return projectAcpSessionRepository(state.sessions[sessionId], extensions);
}

import { ExportedMessageRepository } from "@assistant-ui/react";
import type { ContentBlock, PermissionOptionKind, ToolCallContent } from "@agentclientprotocol/sdk";
import { errorMessage } from "./internal-errors";
import type {
  AcpMessagePiece,
  AcpMessageRecord,
  AcpProjectedMessage,
  AcpSessionState,
  AcpThreadState,
  AcpToolCallRecord,
} from "./types";

type ProjectedPart = Exclude<AcpProjectedMessage["content"], string>[number];
type ProjectedTextPart = Extract<ProjectedPart, { type: "text" | "reasoning" }>;

type AcpPartMetadata = {
  phase: string | null;
  rawPieceIndices: number[];
  rawPieceRefs: Array<{ messageId: string; pieceIndex: number }>;
};

const dataPart = (name: string, data: unknown): ProjectedPart => ({
  type: "data",
  name,
  data,
});

const toDataUrl = (mimeType: string, data: string) => `data:${mimeType};base64,${data}`;

const objectRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const piecePhase = (piece: AcpMessagePiece): string | undefined => {
  if (piece.type !== "content") return undefined;
  const update = objectRecord(piece.notification?.update);
  const meta = objectRecord(update?._meta);
  const codex = objectRecord(meta?.codex);
  return typeof codex?.phase === "string" ? codex.phase : undefined;
};

const acpPartMetadata = (part: ProjectedTextPart): AcpPartMetadata | undefined => {
  const metadata = objectRecord(part.providerMetadata?.acp);
  const rawPieceIndices = metadata?.rawPieceIndices;
  const rawPieceRefs = metadata?.rawPieceRefs;
  if (!Array.isArray(rawPieceIndices) || !rawPieceIndices.every(Number.isInteger)) return undefined;
  if (
    !Array.isArray(rawPieceRefs) ||
    !rawPieceRefs.every(
      (reference) =>
        typeof objectRecord(reference)?.messageId === "string" &&
        Number.isInteger(objectRecord(reference)?.pieceIndex),
    )
  ) {
    return undefined;
  }
  const phase = metadata?.phase;
  if (phase !== null && typeof phase !== "string") return undefined;
  return {
    phase,
    rawPieceIndices: rawPieceIndices as number[],
    rawPieceRefs: rawPieceRefs as Array<{ messageId: string; pieceIndex: number }>,
  };
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
): ProjectedPart[] => {
  const projected: ProjectedPart[] = [];
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
        activePhase = piecePhase(piece) ?? activePhase;
      }

      const next = projectPiece(session, message.id, piece, rawPieceIndex, activePhase);
      const previous = projected.at(-1);
      const canMerge =
        message.role === "assistant" &&
        (next.type === "text" || next.type === "reasoning") &&
        previous?.type === next.type;
      if (!canMerge) {
        projected.push(next);
        continue;
      }

      const previousMetadata = acpPartMetadata(previous);
      const nextMetadata = acpPartMetadata(next);
      if (!previousMetadata || !nextMetadata || previousMetadata.phase !== nextMetadata.phase) {
        projected.push(next);
        continue;
      }

      projected[projected.length - 1] = {
        ...previous,
        text: previous.text + next.text,
        providerMetadata: {
          ...previous.providerMetadata,
          acp: {
            phase: nextMetadata.phase,
            rawPieceIndices: [...previousMetadata.rawPieceIndices, ...nextMetadata.rawPieceIndices],
            rawPieceRefs: [...previousMetadata.rawPieceRefs, ...nextMetadata.rawPieceRefs],
          },
        },
      };
    }
  }
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
    content: projectMessagePieces(session, messages),
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

/** Projects one ACP session into assistant-ui thread messages. */
export function projectAcpThreadMessages(
  state: AcpThreadState,
  sessionId = state.activeSessionId,
): AcpProjectedMessage[] {
  if (!sessionId) return [];
  const session = state.sessions[sessionId];
  if (!session) return [];
  const projected: AcpProjectedMessage[] = [];
  for (let index = 0; index < session.messages.length;) {
    const message = session.messages[index];
    if (!message) break;
    if (message.role === "user") {
      projected.push(projectMessage(session, [message]));
      index += 1;
      continue;
    }

    const assistantMessages: [AcpMessageRecord, ...AcpMessageRecord[]] = [message];
    let nextIndex = index + 1;
    while (session.messages[nextIndex]?.role === "assistant") {
      assistantMessages.push(session.messages[nextIndex] as AcpMessageRecord);
      nextIndex += 1;
    }
    projected.push(projectMessage(session, assistantMessages));
    index = nextIndex;
  }
  return projected;
}

/** Projects all ACP sessions into an assistant-ui exported message repository. */
export function projectAcpThreadRepository(
  state: AcpThreadState,
  sessionId = state.activeSessionId,
): ExportedMessageRepository {
  return ExportedMessageRepository.fromArray(projectAcpThreadMessages(state, sessionId));
}

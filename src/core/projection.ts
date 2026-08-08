import { ExportedMessageRepository } from "@assistant-ui/react";
import type {
  ContentBlock,
  PermissionOptionKind,
  ToolCallContent,
  ToolCallStatus,
} from "@agentclientprotocol/sdk";
import type {
  AcpMessagePiece,
  AcpMessageRecord,
  AcpProjectedMessage,
  AcpSessionState,
  AcpThreadState,
  AcpToolCallRecord,
} from "./types";

type ProjectedPart = Exclude<AcpProjectedMessage["content"], string>[number];

const dataPart = (name: string, data: unknown): ProjectedPart => ({
  type: "data",
  name,
  data,
});

const toDataUrl = (mimeType: string, data: string) =>
  `data:${mimeType};base64,${data}`;

function projectContent(
  content: ContentBlock,
  reasoning: boolean,
): ProjectedPart {
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
            mimeType:
              content.resource.mimeType ?? "application/octet-stream",
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
  kind.replaceAll("_", "-") as
    | "allow-once"
    | "allow-always"
    | "reject-once"
    | "reject-always";

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

  if (
    permission.status === "cancelled" ||
    permission.response?.outcome.outcome === "cancelled"
  ) {
    return { id: tool.toolCallId, options, resolution: "cancelled" as const };
  }

  const optionId =
    permission.response?.outcome.outcome === "selected"
      ? permission.response.outcome.optionId
      : undefined;
  const selected = permission.request.options.find(
    (option) => option.optionId === optionId,
  );
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
  const status = value.status as ToolCallStatus | null | undefined;
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
        rawUpdates: tool.rawUpdates,
      },
    },
    ...(projectToolApproval(tool)
      ? { approval: projectToolApproval(tool) }
      : {}),
  };
}

const projectPiece = (
  session: AcpSessionState,
  piece: AcpMessagePiece,
): ProjectedPart => {
  switch (piece.type) {
    case "content":
      return projectContent(
        piece.content,
        piece.raw.sessionUpdate === "agent_thought_chunk",
      );
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
      return dataPart("acp-unsupported", piece.update);
  }
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
        ...(status.error ? { error: String(status.error) } : {}),
      };
  }
};

const projectMessage = (
  session: AcpSessionState,
  message: AcpMessageRecord,
): AcpProjectedMessage => {
  const raw = message.pieces.map((piece) =>
    piece.type === "content" ? piece.raw : piece,
  );
  return {
    id: message.id,
    role: message.role,
    createdAt: new Date(message.createdAt),
    content: message.pieces.map((piece) => projectPiece(session, piece)),
    ...(statusForMessage(message) ? { status: statusForMessage(message) } : {}),
    metadata: {
      isOptimistic: message.optimistic,
      custom: {
        acp: {
          sessionId: session.sessionId,
          raw,
          notifications: session.rawNotifications,
          stopReason:
            message.status?.type === "complete" ||
            message.status?.type === "incomplete"
              ? message.status.stopReason
              : undefined,
          error: message.error ? String(message.error) : undefined,
        },
      },
    },
  };
};

export function projectAcpThreadMessages(
  state: AcpThreadState,
  sessionId = state.activeSessionId,
): AcpProjectedMessage[] {
  if (!sessionId) return [];
  const session = state.sessions[sessionId];
  if (!session) return [];
  return session.messages.map((message) => projectMessage(session, message));
}

export function projectAcpThreadRepository(
  state: AcpThreadState,
  sessionId = state.activeSessionId,
): ExportedMessageRepository {
  return ExportedMessageRepository.fromArray(
    projectAcpThreadMessages(state, sessionId),
  );
}

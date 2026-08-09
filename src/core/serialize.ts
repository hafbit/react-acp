import type {
  AgentCapabilities,
  ClientCapabilities,
  ContentBlock,
  McpServer,
} from "@agentclientprotocol/sdk";
import type { AppendMessage } from "@assistant-ui/react";
import {
  AcpCapabilityError,
  AcpInvalidWorkspaceError,
  AcpUnsupportedContentError,
} from "./errors";
import type {
  AcpClientServices,
  AcpTerminalServices,
  AcpWorkspace,
} from "./types";

/** Returns whether every terminal operation required by ACP is implemented. */
export const hasCompleteTerminalServices = (
  terminal: AcpTerminalServices | undefined,
): terminal is AcpTerminalServices =>
  Boolean(
    terminal &&
      typeof terminal.create === "function" &&
      typeof terminal.output === "function" &&
      typeof terminal.release === "function" &&
      typeof terminal.waitForExit === "function" &&
      typeof terminal.kill === "function",
  );

const isAbsolutePath = (value: string) =>
  value.startsWith("/") ||
  /^[A-Za-z]:[\\/]/.test(value) ||
  value.startsWith("\\\\");

/**
 * Validates that the workspace and additional directories use absolute paths.
 * @throws {AcpInvalidWorkspaceError} When any path is relative.
 */
export function validateWorkspace(workspace: AcpWorkspace): void {
  for (const path of [workspace.cwd, ...(workspace.additionalDirectories ?? [])]) {
    if (!isAbsolutePath(path)) throw new AcpInvalidWorkspaceError(path);
  }
  for (const server of workspace.mcpServers ?? []) {
    if (!("type" in server) && !isAbsolutePath(server.command)) {
      throw new AcpInvalidWorkspaceError(server.command);
    }
  }
}

/** Builds advertised ACP client capabilities from host services and overrides. */
export function buildClientCapabilities(
  services: AcpClientServices | undefined,
  additions: ClientCapabilities | undefined,
): ClientCapabilities {
  const fs = services?.fileSystem;
  return {
    ...additions,
    fs:
      fs?.readTextFile || fs?.writeTextFile
        ? {
            readTextFile: Boolean(fs.readTextFile),
            writeTextFile: Boolean(fs.writeTextFile),
          }
        : undefined,
    terminal: hasCompleteTerminalServices(services?.terminal) ? true : undefined,
    session: {
      ...additions?.session,
      configOptions: { boolean: {} },
    },
  };
}

/** Builds the workspace portion of ACP new, load, and resume requests. */
export function buildSessionRequest(
  workspace: AcpWorkspace,
  capabilities?: AgentCapabilities,
): {
  cwd: string;
  mcpServers: McpServer[];
  additionalDirectories?: string[];
} {
  validateWorkspace(workspace);
  for (const server of workspace.mcpServers ?? []) {
    if (!("type" in server)) continue;
    if (server.type === "http" && capabilities?.mcpCapabilities?.http !== true) {
      throw new AcpCapabilityError("MCP HTTP transport");
    }
    if (server.type === "sse" && capabilities?.mcpCapabilities?.sse !== true) {
      throw new AcpCapabilityError("MCP SSE transport");
    }
    if (server.type === "acp") {
      throw new AcpCapabilityError(
        "MCP ACP transport",
        "The ACP MCP transport is UNSTABLE and is not enabled by react-acp 0.1.1.",
      );
    }
  }
  return {
    cwd: workspace.cwd,
    mcpServers: [...(workspace.mcpServers ?? [])],
    ...(workspace.additionalDirectories?.length &&
    capabilities?.sessionCapabilities?.additionalDirectories != null
      ? { additionalDirectories: [...workspace.additionalDirectories] }
      : {}),
  };
}

const parseDataUrl = (value: string) => {
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(value);
  return match ? { mimeType: match[1]!, data: match[2]! } : undefined;
};

const ensureCapability = (
  supported: boolean | undefined,
  contentType: string,
) => {
  if (!supported) {
    throw new AcpUnsupportedContentError(
      contentType,
      `The ACP agent did not advertise prompt support for '${contentType}'.`,
    );
  }
};

function serializePart(
  part: AppendMessage["content"][number],
  capabilities: AgentCapabilities | undefined,
): ContentBlock {
  switch (part.type) {
    case "text":
      return { type: "text", text: part.text };
    case "image": {
      ensureCapability(capabilities?.promptCapabilities?.image, "image");
      const parsed = parseDataUrl(part.image);
      if (parsed) return { type: "image", ...parsed };
      return {
        type: "image",
        data: "",
        mimeType: "application/octet-stream",
        uri: part.image,
      };
    }
    case "file": {
      if (part.mimeType.startsWith("audio/")) {
        ensureCapability(capabilities?.promptCapabilities?.audio, "audio");
        const parsed = parseDataUrl(part.data);
        return {
          type: "audio",
          data: parsed?.data ?? part.data,
          mimeType: parsed?.mimeType ?? part.mimeType,
        };
      }
      if (part.sourceType === "url" || /^https?:\/\//i.test(part.data)) {
        return {
          type: "resource_link",
          uri: part.data,
          name: part.filename ?? "resource",
          mimeType: part.mimeType,
        };
      }
      ensureCapability(
        capabilities?.promptCapabilities?.embeddedContext,
        "embedded resource",
      );
      return {
        type: "resource",
        resource: {
          uri: part.filename ?? "attachment",
          mimeType: part.mimeType,
          blob: part.data,
        },
      };
    }
    case "audio": {
      ensureCapability(capabilities?.promptCapabilities?.audio, "audio");
      return {
        type: "audio",
        data: part.audio.data,
        mimeType: `audio/${part.audio.format}`,
      };
    }
    case "data": {
      if (part.name === "acp-resource-link") {
        return part.data as ContentBlock;
      }
      if (part.name === "acp-resource") {
        ensureCapability(
          capabilities?.promptCapabilities?.embeddedContext,
          "embedded resource",
        );
        return part.data as ContentBlock;
      }
      throw new AcpUnsupportedContentError(`data:${part.name}`);
    }
    default:
      throw new AcpUnsupportedContentError(part.type);
  }
}

/**
 * Serializes one assistant-ui user append into ACP prompt content blocks.
 * @throws {AcpUnsupportedContentError} When role, content, or capability is unsupported.
 */
export function serializeAppendMessage(
  message: AppendMessage,
  capabilities: AgentCapabilities | undefined,
): ContentBlock[] {
  if (message.role !== "user") {
    throw new AcpUnsupportedContentError(
      message.role,
      "ACP session/prompt only accepts user messages from the composer.",
    );
  }
  return message.content.map((part) => serializePart(part, capabilities));
}

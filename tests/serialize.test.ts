import type { AppendMessage } from "@assistant-ui/react";
import { describe, expect, it } from "vitest";
import {
  buildClientCapabilities,
  buildSessionRequest,
  serializeAppendMessage,
  validateWorkspace,
} from "../src/core/serialize";
import {
  AcpCapabilityError,
  AcpInvalidWorkspaceError,
  AcpUnsupportedContentError,
} from "../src/core/errors";

describe("ACP serialization and capabilities", () => {
  it("拒绝相对工作区路径", () => {
    expect(() => validateWorkspace({ cwd: "relative/path" })).toThrow(AcpInvalidWorkspaceError);
  });

  it("拒绝使用相对命令的 stdio MCP server", () => {
    expect(() =>
      validateWorkspace({
        cwd: "/workspace",
        mcpServers: [{ name: "mcp", command: "node", args: [], env: [] }],
      }),
    ).toThrow(AcpInvalidWorkspaceError);
  });

  it("仅在 Agent 声明能力时发送 additionalDirectories", () => {
    const workspace = { cwd: "/workspace", additionalDirectories: ["/shared"] };
    expect(buildSessionRequest(workspace)).not.toHaveProperty("additionalDirectories");
    expect(
      buildSessionRequest(workspace, {
        sessionCapabilities: { additionalDirectories: {} },
      }),
    ).toHaveProperty("additionalDirectories", ["/shared"]);
  });

  it("按 Agent capability 门控 HTTP/SSE MCP transport", () => {
    const workspace = {
      cwd: "/workspace",
      mcpServers: [
        {
          type: "http" as const,
          name: "remote",
          url: "https://example.test/mcp",
          headers: [],
        },
      ],
    };
    expect(() => buildSessionRequest(workspace, {})).toThrow(AcpCapabilityError);
    expect(
      buildSessionRequest(workspace, {
        mcpCapabilities: { http: true },
      }).mcpServers,
    ).toEqual(workspace.mcpServers);
  });

  it("只声明实际注入的文件系统和整组终端能力", () => {
    const readTextFile = async () => ({ content: "ok" });
    const capabilities = buildClientCapabilities(
      { fileSystem: { readTextFile } },
      { fs: { writeTextFile: true }, terminal: true },
    );
    expect(capabilities.fs).toEqual({ readTextFile: true, writeTextFile: false });
    expect(capabilities.terminal).toBeUndefined();
  });

  it("按 prompt capabilities 序列化文本、图片、音频和资源", () => {
    const message = {
      role: "user",
      content: [
        { type: "text", text: "hello" },
        { type: "image", image: "data:image/png;base64,YQ==" },
        {
          type: "file",
          sourceType: "url",
          filename: "docs",
          mimeType: "text/html",
          data: "https://example.test/docs",
        },
        {
          type: "audio",
          audio: { data: "YQ==", format: "wav" },
        },
      ],
    } as unknown as AppendMessage;
    expect(
      serializeAppendMessage(message, {
        promptCapabilities: { image: true, audio: true },
      }),
    ).toMatchObject([
      { type: "text", text: "hello" },
      { type: "image", mimeType: "image/png", data: "YQ==" },
      { type: "resource_link", uri: "https://example.test/docs" },
      { type: "audio", mimeType: "audio/wav", data: "YQ==" },
    ]);
  });

  it("将附件内容合并到 ACP prompt", () => {
    const message = {
      role: "user",
      content: [{ type: "text", text: "describe this image" }],
      attachments: [
        {
          id: "clipboard-image",
          type: "image",
          name: "clipboard.png",
          content: [{ type: "image", image: "data:image/png;base64,YQ==" }],
        },
      ],
    } as unknown as AppendMessage;

    expect(
      serializeAppendMessage(message, {
        promptCapabilities: { image: true },
      }),
    ).toEqual([
      { type: "text", text: "describe this image" },
      { type: "image", mimeType: "image/png", data: "YQ==" },
    ]);
  });

  it("不对未声明支持的内容静默降级", () => {
    const message = {
      role: "user",
      content: [{ type: "image", image: "data:image/png;base64,YQ==" }],
    } as unknown as AppendMessage;
    expect(() => serializeAppendMessage(message, {})).toThrow(AcpUnsupportedContentError);
  });

  it("附件图片仍受 prompt image capability 门控", () => {
    const message = {
      role: "user",
      content: [{ type: "text", text: "hello" }],
      attachments: [
        {
          content: [{ type: "image", image: "data:image/png;base64,YQ==" }],
        },
      ],
    } as unknown as AppendMessage;

    expect(() => serializeAppendMessage(message, {})).toThrow(AcpUnsupportedContentError);
  });
});

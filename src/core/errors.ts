export class AcpError extends Error {
  readonly code: string;
  readonly cause?: unknown;

  constructor(code: string, message: string, cause?: unknown) {
    super(message);
    this.name = "AcpError";
    this.code = code;
    this.cause = cause;
  }
}

export class AcpCapabilityError extends AcpError {
  constructor(capability: string, message?: string) {
    super(
      "ACP_CAPABILITY_UNAVAILABLE",
      message ?? `The ACP agent did not advertise '${capability}'.`,
    );
    this.name = "AcpCapabilityError";
  }
}

export class AcpUnsupportedContentError extends AcpError {
  readonly contentType: string;

  constructor(contentType: string, message?: string) {
    super(
      "ACP_UNSUPPORTED_CONTENT",
      message ?? `Cannot serialize assistant-ui content '${contentType}' to ACP.`,
    );
    this.name = "AcpUnsupportedContentError";
    this.contentType = contentType;
  }
}

export class AcpInvalidWorkspaceError extends AcpError {
  constructor(path: string) {
    super("ACP_INVALID_WORKSPACE", `ACP workspace paths must be absolute: ${path}`);
    this.name = "AcpInvalidWorkspaceError";
  }
}

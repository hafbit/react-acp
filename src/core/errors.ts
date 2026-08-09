/** Base error for ACP runtime, validation, serialization, and lifecycle failures. */
export class AcpError extends Error {
  /** Stable machine-readable error code. */
  readonly code: string;
  /** Original failure, when the error wraps another exception. */
  readonly cause?: unknown;

  /** Creates an ACP error with a stable code and optional original cause. */
  constructor(code: string, message: string, cause?: unknown) {
    super(message);
    this.name = "AcpError";
    this.code = code;
    this.cause = cause;
  }
}

/** Indicates that an operation is unavailable under advertised ACP capabilities. */
export class AcpCapabilityError extends AcpError {
  /** Creates an error for an operation not advertised by the connected agent. */
  constructor(capability: string, message?: string) {
    super(
      "ACP_CAPABILITY_UNAVAILABLE",
      message ?? `The ACP agent did not advertise '${capability}'.`,
    );
    this.name = "AcpCapabilityError";
  }
}

/** Indicates that assistant-ui content cannot be serialized to ACP. */
export class AcpUnsupportedContentError extends AcpError {
  /** The unsupported assistant-ui content kind. */
  readonly contentType: string;

  /** Creates an error for an assistant-ui content kind that ACP cannot accept. */
  constructor(contentType: string, message?: string) {
    super(
      "ACP_UNSUPPORTED_CONTENT",
      message ?? `Cannot serialize assistant-ui content '${contentType}' to ACP.`,
    );
    this.name = "AcpUnsupportedContentError";
    this.contentType = contentType;
  }
}

/** Indicates that an ACP workspace path is not absolute. */
export class AcpInvalidWorkspaceError extends AcpError {
  /** Creates an error for a relative workspace path. */
  constructor(path: string) {
    super("ACP_INVALID_WORKSPACE", `ACP workspace paths must be absolute: ${path}`);
    this.name = "AcpInvalidWorkspaceError";
  }
}

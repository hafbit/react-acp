import { describe, expect, it } from "vitest";
import { errorMessage, toError } from "../src/core/internal-errors";

describe("internal error normalization", () => {
  it("preserves Error messages and serializes structured failures", () => {
    expect(errorMessage(new Error("network"))).toBe("network");
    expect(errorMessage({ code: "ACP_FAILURE", retryable: false })).toBe(
      '{"code":"ACP_FAILURE","retryable":false}',
    );
  });

  it("falls back safely for cyclic objects", () => {
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;

    expect(errorMessage(cyclic)).toBe("Unknown error");
  });

  it("converts non-Error rejection values into Error instances", () => {
    const error = toError({ code: "ACP_FAILURE" });

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe('{"code":"ACP_FAILURE"}');
  });
});

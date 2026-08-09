import { describe, expect, it } from "vitest";
import { AcpDiff, AcpResource, AcpTerminal, AcpUnsupported } from "../src";
import {
  AcpDiff as PrimitiveDiff,
  AcpResource as PrimitiveResource,
  AcpTerminal as PrimitiveTerminal,
  AcpUnsupported as PrimitiveUnsupported,
} from "../src/primitives";

describe("public primitive exports", () => {
  it("从主入口和 primitives 入口导出全部无样式组件", () => {
    expect([AcpDiff, AcpTerminal, AcpResource, AcpUnsupported]).toEqual([
      PrimitiveDiff,
      PrimitiveTerminal,
      PrimitiveResource,
      PrimitiveUnsupported,
    ]);
  });
});

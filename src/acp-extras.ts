import {
  createRuntimeExtras,
  type RuntimeExtras,
} from "@assistant-ui/core/react";
import type { AcpRuntimeExtras } from "./core/types";

export const acpExtras: RuntimeExtras<AcpRuntimeExtras> =
  createRuntimeExtras<AcpRuntimeExtras>("useAcpRuntime");

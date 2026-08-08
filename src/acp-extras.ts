import { createRuntimeExtras } from "@assistant-ui/core/react";
import type { AcpRuntimeExtras } from "./core/types";

export const acpExtras = createRuntimeExtras<AcpRuntimeExtras>("useAcpRuntime");

/**
 * React bindings for projecting Agent Client Protocol sessions into an
 * assistant-ui runtime, including ACP-aware hooks and unstyled primitives.
 *
 * @module
 */

export { useAcpRuntime } from "./useAcpRuntime";
export {
  useAcpAuth,
  useAcpCommands,
  useAcpConfigOptions,
  useAcpConnection,
  useAcpModes,
  useAcpPermissions,
  useAcpPlan,
  useAcpRuntimeExtras,
  useAcpSession,
  useAcpThreadState,
  useAcpUsage,
} from "./hooks";
export * from "./core/types";
export * from "./primitives/index";

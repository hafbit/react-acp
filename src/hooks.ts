"use client";

import { useMemo } from "react";
import { acpExtras } from "./acp-extras";
import {
  createAcpThreadState,
  type AcpAuthHookState,
  type AcpConnectionHookState,
  type AcpPermissionsHookState,
  type AcpRuntimeExtras,
  type AcpSessionState,
  type AcpThreadState,
} from "./core";

const EMPTY_STATE = createAcpThreadState();

/** Returns the ACP-specific commands and state attached to the current runtime. */
export const useAcpRuntimeExtras = (): AcpRuntimeExtras => acpExtras.use();

/** Returns connection status, advertised capabilities, errors, and reconnect. */
export const useAcpConnection = (): AcpConnectionHookState => {
  const extras = acpExtras.use((value) => value, undefined);
  return useMemo(
    () => ({
      status: extras?.state.connectionStatus ?? ("idle" as const),
      error: extras?.state.connectionError,
      capabilities: extras?.state.capabilities,
      reconnect: extras?.reconnect ?? (async () => {}),
    }),
    [extras],
  );
};

/** Returns the active ACP session, or `undefined` before one is selected. */
export const useAcpSession = (): AcpSessionState | undefined =>
  acpExtras.use((extras) => extras.session, undefined);

/** Returns the complete ACP thread state. */
export function useAcpThreadState(): AcpThreadState;
/** Selects a derived value from the complete ACP thread state. */
export function useAcpThreadState<T>(selector: (state: AcpThreadState) => T): T;
export function useAcpThreadState<T>(selector?: (state: AcpThreadState) => T): AcpThreadState | T {
  return acpExtras.use(
    (extras) => (selector ? selector(extras.state) : extras.state),
    selector ? selector(EMPTY_STATE) : EMPTY_STATE,
  );
}

/** Returns advertised authentication methods and authentication actions. */
export const useAcpAuth = (): AcpAuthHookState => {
  const extras = acpExtras.use((value) => value, undefined);
  return useMemo(
    () => ({
      methods: extras?.state.authMethods ?? [],
      required: extras?.state.connectionStatus === "auth-required",
      authenticate:
        extras?.authenticate ??
        (async () => {
          throw new Error("ACP runtime is not ready");
        }),
      logout: extras?.logout ?? (async () => {}),
    }),
    [extras],
  );
};

/** Returns pending tool permissions for the active session and a reply action. */
export const useAcpPermissions = (): AcpPermissionsHookState => {
  const extras = acpExtras.use((value) => value, undefined);
  const pending = extras?.session
    ? Object.values(extras.session.permissions).filter(
        (permission) => permission.status === "pending",
      )
    : [];
  return {
    pending,
    reply:
      extras?.replyToPermission ??
      (async () => {
        throw new Error("ACP runtime is not ready");
      }),
  };
};

/** Returns the latest plan update for the active session. */
export const useAcpPlan = (): AcpSessionState["plan"] => useAcpSession()?.plan;
/** Returns the commands currently advertised by the active ACP session. */
export const useAcpCommands = (): AcpSessionState["commands"] => useAcpSession()?.commands ?? [];
/** Returns the available and selected modes for the active session. */
export const useAcpModes = (): AcpSessionState["modes"] => useAcpSession()?.modes;
/** Returns the configuration options currently advertised by the active session. */
export const useAcpConfigOptions = (): AcpSessionState["configOptions"] =>
  useAcpSession()?.configOptions ?? [];
/** Returns the latest ACP usage update for the active session. */
export const useAcpUsage = (): AcpSessionState["usage"] => useAcpSession()?.usage;

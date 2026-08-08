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

export const useAcpRuntimeExtras = (): AcpRuntimeExtras => acpExtras.use();

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

export const useAcpSession = (): AcpSessionState | undefined =>
  acpExtras.use((extras) => extras.session, undefined);

export function useAcpThreadState(): AcpThreadState;
export function useAcpThreadState<T>(selector: (state: AcpThreadState) => T): T;
export function useAcpThreadState<T>(
  selector?: (state: AcpThreadState) => T,
): AcpThreadState | T {
  return acpExtras.use(
    (extras) => (selector ? selector(extras.state) : extras.state),
    selector ? selector(EMPTY_STATE) : EMPTY_STATE,
  );
}

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

export const useAcpPlan = (): AcpSessionState["plan"] =>
  useAcpSession()?.plan;
export const useAcpCommands = (): AcpSessionState["commands"] =>
  useAcpSession()?.commands ?? [];
export const useAcpModes = (): AcpSessionState["modes"] =>
  useAcpSession()?.modes;
export const useAcpConfigOptions = (): AcpSessionState["configOptions"] =>
  useAcpSession()?.configOptions ?? [];
export const useAcpUsage = (): AcpSessionState["usage"] =>
  useAcpSession()?.usage;

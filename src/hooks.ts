"use client";

import { useMemo } from "react";
import { acpExtras } from "./acp-extras";
import { createAcpThreadState, type AcpThreadState } from "./core";

const EMPTY_STATE = createAcpThreadState();

export const useAcpRuntimeExtras = () => acpExtras.use();

export const useAcpConnection = () => {
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

export const useAcpSession = () =>
  acpExtras.use((extras) => extras.session, undefined);

export function useAcpThreadState(): AcpThreadState;
export function useAcpThreadState<T>(selector: (state: AcpThreadState) => T): T;
export function useAcpThreadState<T>(
  selector?: (state: AcpThreadState) => T,
) {
  return acpExtras.use(
    (extras) => (selector ? selector(extras.state) : extras.state),
    selector ? selector(EMPTY_STATE) : EMPTY_STATE,
  );
}

export const useAcpAuth = () => {
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

export const useAcpPermissions = () => {
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

export const useAcpPlan = () => useAcpSession()?.plan;
export const useAcpCommands = () => useAcpSession()?.commands ?? [];
export const useAcpModes = () => useAcpSession()?.modes;
export const useAcpConfigOptions = () => useAcpSession()?.configOptions ?? [];
export const useAcpUsage = () => useAcpSession()?.usage;

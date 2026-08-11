"use client";

import {
  pickExternalStoreSharedOptions,
  useExternalStoreRuntime,
  type AppendMessage,
  type AssistantRuntime,
  type RespondToToolApprovalOptions,
  type ThreadMessage,
} from "@assistant-ui/react";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { acpExtras } from "./acp-extras";
import {
  AcpCapabilityError,
  AcpProjectionCache,
  AcpThreadController,
  hasAgentCapability,
  projectAcpSessionRepository,
  type AcpRuntimeExtras,
  type AcpRuntimeOptions,
} from "./core";

const useControllerState = (controller: AcpThreadController) =>
  useSyncExternalStore(controller.subscribe, controller.getState, controller.getState);

const choosePermissionOption = (
  extras: AcpRuntimeExtras,
  response: RespondToToolApprovalOptions,
) => {
  if (response.optionId) return response.optionId;
  const session = extras.session;
  const request = session?.permissions[response.approvalId]?.request;
  const prefix = response.approved ? "allow" : "reject";
  return request?.options.find((option) => option.kind.startsWith(prefix))?.optionId;
};

/**
 * Creates an assistant-ui runtime backed by an ACP v1 connection.
 *
 * The hook connects on mount, projects ACP sessions as assistant-ui threads,
 * and disconnects on unmount. The ACP session remains the authoritative source
 * for messages, tools, permissions, plans, modes, configuration, and usage.
 *
 * @param options Connection, workspace, client-service, and assistant-ui options.
 * @returns An assistant-ui runtime suitable for `AssistantRuntimeProvider`.
 * @throws {AcpError} When the workspace or ACP connection is invalid.
 */
export function useAcpRuntime(options: AcpRuntimeOptions): AssistantRuntime {
  const latestOptions = useRef(options);
  latestOptions.current = options;
  const [controller] = useState(
    () =>
      new AcpThreadController({
        ...options,
        onError: (error) => latestOptions.current.onError?.(error),
        onThreadIdChange: (threadId) => latestOptions.current.onThreadIdChange?.(threadId),
        onPreparedSessionIdChange: (sessionId) =>
          latestOptions.current.onPreparedSessionIdChange?.(sessionId),
      }),
  );
  const state = useControllerState(controller);

  useEffect(() => {
    void controller.connect().catch(() => {});
    return () => controller.disconnect();
  }, [controller]);

  useEffect(() => {
    if (
      options.threadId &&
      state.connectionStatus === "ready" &&
      state.activeSessionId !== options.threadId
    ) {
      void controller
        .selectSession(options.threadId, { notify: false })
        .catch((error) => latestOptions.current.onError?.(error));
    }
  }, [controller, options.threadId, state.connectionStatus, state.activeSessionId]);

  const session = state.activeSessionId ? state.sessions[state.activeSessionId] : undefined;
  const extras = useMemo<AcpRuntimeExtras>(
    () => ({
      state,
      session,
      reconnect: () => controller.reconnect(),
      refreshSessions: () => controller.refreshSessions(),
      authenticate: (methodId) => controller.authenticate(methodId),
      logout: () => controller.logout(),
      selectSession: (sessionId) => controller.selectSession(sessionId),
      reloadSession: (sessionId) => controller.reloadSession(sessionId),
      createSession: () => controller.createSession(),
      prepareSession: () => controller.prepareSession(),
      deleteSession: (sessionId) => controller.deleteSession(sessionId),
      resumeSession: (sessionId) => controller.resumeSession(sessionId),
      closeSession: (sessionId) => controller.closeSession(sessionId),
      setMode: async (modeId) => {
        if (!state.activeSessionId) {
          throw new AcpCapabilityError("active session");
        }
        await controller.setMode(state.activeSessionId, modeId);
      },
      setConfigOption: async (configId, value) => {
        if (!state.activeSessionId) {
          throw new AcpCapabilityError("active session");
        }
        await controller.setConfigOption(state.activeSessionId, configId, value);
      },
      replyToPermission: async (toolCallId, optionId) => {
        if (!state.activeSessionId) return;
        await controller.replyToPermission(state.activeSessionId, toolCallId, optionId);
      },
    }),
    [controller, session, state],
  );

  const projectionCache = useMemo(
    () => new AcpProjectionCache(),
    [options.extensions, session?.sessionId],
  );
  const messageRepository = useMemo(
    () => projectAcpSessionRepository(session, options.extensions, projectionCache),
    [options.extensions, projectionCache, session],
  );

  const threadList = useMemo(
    () => ({
      threadId: state.activeSessionId,
      isLoading: state.connectionStatus === "connecting",
      threads: state.sessionOrder.map((sessionId) => {
        const item = state.sessions[sessionId];
        return {
          id: sessionId,
          remoteId: sessionId,
          externalId: sessionId,
          status: "regular" as const,
          title: item?.info?.title ?? sessionId,
          custom: { acp: item?.info },
        };
      }),
      onSwitchToNewThread: async () => {
        await controller.createSession();
      },
      onSwitchToThread: (sessionId: string) => controller.selectSession(sessionId),
      ...(hasAgentCapability(state.capabilities, "delete")
        ? { onDelete: (sessionId: string) => controller.deleteSession(sessionId) }
        : {}),
    }),
    [controller, state],
  );

  return useExternalStoreRuntime<ThreadMessage>({
    ...pickExternalStoreSharedOptions(options),
    isLoading: state.connectionStatus === "connecting" || session?.runState === "loading",
    isDisabled:
      state.connectionStatus === "auth-required" ||
      state.connectionStatus === "error" ||
      state.connectionStatus === "closed",
    isSendDisabled:
      state.connectionStatus !== "ready" ||
      session?.runState === "loading" ||
      session?.runState === "error" ||
      session?.runState === "running" ||
      session?.runState === "cancelling" ||
      session?.access.mode === "read-only",
    isRunning: session?.runState === "running" || session?.runState === "cancelling",
    messageRepository,
    extras: acpExtras.provide(extras),
    adapters: {
      ...options.adapters,
      threadList,
    },
    onNew: (message: AppendMessage) => controller.sendMessage(message),
    onCancel: async () => {
      if (state.activeSessionId) await controller.cancel(state.activeSessionId);
    },
    onRespondToToolApproval: async (response) => {
      const optionId = choosePermissionOption(extras, response);
      await extras.replyToPermission(response.approvalId, optionId);
    },
  });
}

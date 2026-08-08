"use client";

import type { ComponentPropsWithoutRef, ReactNode } from "react";
import {
  useAcpAuth,
  useAcpCommands,
  useAcpConfigOptions,
  useAcpModes,
  useAcpPermissions,
  useAcpPlan,
  useAcpRuntimeExtras,
  useAcpUsage,
} from "../hooks";

type DivProps = ComponentPropsWithoutRef<"div">;

export function AcpAuthMethods({ children, ...props }: DivProps) {
  const auth = useAcpAuth();
  if (!auth.required) return null;
  return (
    <div {...props}>
      {children}
      {auth.methods.map((method) => (
        <button
          type="button"
          key={method.id}
          onClick={() => void auth.authenticate(method.id)}
        >
          {method.name}
        </button>
      ))}
    </div>
  );
}

export function AcpPermissionList({ children, ...props }: DivProps) {
  const { pending, reply } = useAcpPermissions();
  if (!pending.length) return null;
  return (
    <div {...props}>
      {children}
      {pending.map(({ request }) => (
        <fieldset key={request.toolCall.toolCallId}>
          <legend>{request.toolCall.title ?? request.toolCall.toolCallId}</legend>
          {request.options.map((option) => (
            <button
              type="button"
              key={option.optionId}
              onClick={() =>
                void reply(request.toolCall.toolCallId, option.optionId)
              }
            >
              {option.name}
            </button>
          ))}
          <button
            type="button"
            onClick={() => void reply(request.toolCall.toolCallId)}
          >
            Cancel
          </button>
        </fieldset>
      ))}
    </div>
  );
}

export function AcpPlan({ children, ...props }: DivProps) {
  const plan = useAcpPlan();
  if (!plan) return null;
  return (
    <div {...props}>
      {children}
      <ol>
        {plan.entries.map((entry, index) => (
          <li
            key={`${index}:${entry.content}`}
            data-status={entry.status}
            data-priority={entry.priority}
          >
            {entry.content}
          </li>
        ))}
      </ol>
    </div>
  );
}

export function AcpModeSelect(
  props: Omit<ComponentPropsWithoutRef<"select">, "value" | "onChange">,
) {
  const modes = useAcpModes();
  const extras = useAcpRuntimeExtras();
  if (!modes) return null;
  return (
    <select
      {...props}
      value={modes.currentModeId}
      onChange={(event) => void extras.setMode(event.currentTarget.value)}
    >
      {modes.availableModes.map((mode) => (
        <option key={mode.id} value={mode.id} title={mode.description ?? undefined}>
          {mode.name}
        </option>
      ))}
    </select>
  );
}

export function AcpConfigOptions({ children, ...props }: DivProps) {
  const options = useAcpConfigOptions();
  const extras = useAcpRuntimeExtras();
  if (!options.length) return null;
  return (
    <div {...props}>
      {children}
      {options.map((option) => (
        <label key={option.id} title={option.description ?? undefined}>
          <span>{option.name}</span>
          {option.type === "boolean" ? (
            <input
              type="checkbox"
              checked={option.currentValue}
              onChange={(event) =>
                void extras.setConfigOption(option.id, event.currentTarget.checked)
              }
            />
          ) : (
            <select
              value={option.currentValue}
              onChange={(event) =>
                void extras.setConfigOption(option.id, event.currentTarget.value)
              }
            >
              {option.options.flatMap((item) =>
                "group" in item ? (
                  <optgroup key={item.group} label={item.name}>
                    {item.options.map((nested) => (
                      <option key={nested.value} value={nested.value}>
                        {nested.name}
                      </option>
                    ))}
                  </optgroup>
                ) : (
                  <option key={item.value} value={item.value}>
                    {item.name}
                  </option>
                ),
              )}
            </select>
          )}
        </label>
      ))}
    </div>
  );
}

export function AcpCommandMenu({
  onSelect,
  children,
  ...props
}: DivProps & { onSelect?: (prompt: string) => void }) {
  const commands = useAcpCommands();
  if (!commands.length) return null;
  return (
    <div {...props}>
      {children}
      {commands.map((command) => (
        <button
          type="button"
          key={command.name}
          title={command.description}
          onClick={() => onSelect?.(`/${command.name}`)}
        >
          /{command.name}
        </button>
      ))}
    </div>
  );
}

export function AcpUsage({
  render,
  ...props
}: DivProps & {
  render?: (usage: NonNullable<ReturnType<typeof useAcpUsage>>) => ReactNode;
}) {
  const usage = useAcpUsage();
  if (!usage) return null;
  return (
    <div {...props}>
      {render?.(usage) ?? (
        <span>
          {usage.used}/{usage.size}
          {usage.cost ? ` · ${usage.cost.amount} ${usage.cost.currency}` : ""}
        </span>
      )}
    </div>
  );
}

type AcpArtifact = {
  acp?: {
    title?: string;
    kind?: string;
    status?: string;
    content?: readonly unknown[];
    locations?: readonly unknown[];
    rawInput?: unknown;
    rawOutput?: unknown;
  };
};

export function AcpToolArtifact({
  artifact,
  ...props
}: DivProps & { artifact: unknown }) {
  const acp = (artifact as AcpArtifact | null)?.acp;
  if (!acp) return null;
  return (
    <div {...props} data-kind={acp.kind} data-status={acp.status}>
      {acp.title ? <strong>{acp.title}</strong> : null}
      {acp.content?.map((part, index) => (
        <pre key={index}>{JSON.stringify(part, null, 2)}</pre>
      ))}
    </div>
  );
}

export function AcpDataPart({
  name,
  data,
  ...props
}: DivProps & { name: string; data: unknown }) {
  return (
    <div {...props} data-acp-part={name}>
      <pre>{JSON.stringify(data, null, 2)}</pre>
    </div>
  );
}

export function AcpDiff({ diff, ...props }: DivProps & { diff: unknown }) {
  return (
    <div {...props} data-acp-part="diff">
      <pre>{typeof diff === "string" ? diff : JSON.stringify(diff, null, 2)}</pre>
    </div>
  );
}

export function AcpTerminal({
  terminal,
  ...props
}: DivProps & { terminal: unknown }) {
  return (
    <div {...props} data-acp-part="terminal">
      <pre>{JSON.stringify(terminal, null, 2)}</pre>
    </div>
  );
}

type ResourceLike = {
  type?: string;
  uri?: string;
  name?: string;
  title?: string | null;
};

export function AcpResource({
  resource,
  ...props
}: DivProps & { resource: unknown }) {
  const value = resource as ResourceLike | null;
  if (value?.type === "resource_link" && value.uri) {
    return (
      <div {...props} data-acp-part="resource">
        <a href={value.uri}>{value.title ?? value.name ?? value.uri}</a>
      </div>
    );
  }
  return (
    <div {...props} data-acp-part="resource">
      <pre>{JSON.stringify(resource, null, 2)}</pre>
    </div>
  );
}

export function AcpUnsupported({
  value,
  ...props
}: DivProps & { value: unknown }) {
  return (
    <div {...props} data-acp-part="unsupported">
      <pre>{JSON.stringify(value, null, 2)}</pre>
    </div>
  );
}

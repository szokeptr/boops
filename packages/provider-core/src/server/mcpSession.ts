import type { EnvironmentId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";

/**
 * A remote MCP server the bot turned on (a Pocks connector). `url` is the T3 server's proxy for
 * it, so `headers` carry the thread's T3 credential, never the third-party token.
 */
export interface McpConnectorServer {
  /** Stable per connection and safe as a provider config key: `[a-z0-9_]`, at most 24 chars. */
  readonly name: string;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
}

export interface McpProviderSessionConfig {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly providerSessionId: string;
  readonly providerInstanceId: ProviderInstanceId;
  readonly endpoint: string;
  readonly authorizationHeader: string;
  /** Omit preview_* instructions when the user withholds agent browser access. */
  readonly browserToolsAvailable: boolean;
  readonly capabilities?: ReadonlySet<string>;
  readonly agentDeviceEnvironment?: Readonly<Record<string, string>>;
  /** Refreshed at every turn start; adapters read it where they add `boops`. */
  readonly connectors?: ReadonlyArray<McpConnectorServer>;
}

/** Changes when the connector set does, so adapters can tell a session needs it re-registered. */
export const connectorServersKey = (
  config: Pick<McpProviderSessionConfig, "connectors"> | undefined,
): string =>
  JSON.stringify((config?.connectors ?? []).map((server) => [server.name, server.url]).toSorted());

export function withAgentDeviceEnvironment(
  base: NodeJS.ProcessEnv,
  config: Pick<McpProviderSessionConfig, "agentDeviceEnvironment"> | undefined,
): NodeJS.ProcessEnv {
  const extra = config?.agentDeviceEnvironment;
  if (!extra) return base;
  const separator = extra.PATH_SEPARATOR ?? ":";
  const basePath = base.PATH ?? base.Path;
  const { PATH: shimDir, PATH_SEPARATOR: _separator, ...rest } = extra;
  return {
    ...base,
    ...rest,
    ...(shimDir ? { PATH: basePath ? `${shimDir}${separator}${basePath}` : shimDir } : {}),
  };
}

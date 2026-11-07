// @effect-diagnostics nodeBuiltinImport:off -- The fake authorization server checks PKCE with node:crypto.
import * as NodeCrypto from "node:crypto";
import * as PlatformNodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  EnvironmentMemberId,
  CommandId,
  ConnectorConnectionId,
  EventId,
  MessageId,
  NodeId,
  type OrchestrationProjectShell,
  type Project,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderThreadId,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import { expect, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as TestClock from "effect/testing/TestClock";
import * as HttpClient from "effect/http/HttpClient";
import type * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as ProviderContinuationRequests from "@t3tools/provider-core/server/ProviderContinuationRequests";
import type * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import type * as McpInvocationContext from "../mcp/McpInvocationContext.ts";
import { CodexProviderCapabilitiesV2 } from "../orchestration-v2/Adapters/CodexAdapterV2.ts";
import * as CommandReceiptStore from "../orchestration-v2/CommandReceiptStore.ts";
import * as EventSink from "../orchestration-v2/EventSink.ts";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ProviderAdapterRegistry from "../orchestration-v2/ProviderAdapterRegistry.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as ProviderReplayHarness from "../orchestration-v2/testkit/ProviderReplayHarness.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as Connectors from "./Connectors.ts";

const instanceId = ProviderInstanceId.make("codex");
const driver = ProviderDriverKind.make("codex");
const modelSelection = { instanceId, model: "gpt-5.4" };
const botId = ProjectId.make("project:bot");
const otherBotId = ProjectId.make("project:other-bot");
const threadId = ThreadId.make("thread:bot");
const runId = RunId.make("run:bot");
const rootNode = NodeId.make("node:bot:root");
const ORIGIN = "http://localhost:3773";
const ACME = "https://mcp.acme.test/mcp";
const OPEN = "https://open.acme.test/mcp";
const GMAIL = "https://gmailmcp.googleapis.com/mcp/v1";
const CALENDAR = "https://calendarmcp.googleapis.com/mcp/v1";
const GOOGLE_CLIENT = { clientId: "123-work.apps.googleusercontent.com", clientSecret: "GOCSPX-s" };

const scope: McpInvocationContext.McpInvocationScope = {
  environmentId: "environment-local" as McpInvocationContext.McpInvocationScope["environmentId"],
  requestNamespace: "provider-session:bot",
  thread: { threadId, providerSessionId: "provider-session:bot", providerInstanceId: instanceId },
  client: undefined,
  capabilities: new Set(["orchestration"]),
  issuedAt: 1,
};

/**
 * One remote MCP server behind OAuth (ACME, with its authorization server), one open one, and
 * Google's: no client registration, `initialize` without a token, and a token endpoint that wants
 * the user's client secret. It checks PKCE, the resource indicator, and the tokens it issued.
 */
const makeWorld = () => {
  const world = {
    registrations: 0,
    refreshes: 0,
    refreshFails: false,
    challenges: new Map<string, string>(),
    validTokens: new Set<string>(),
    issued: 0,
    googleRefreshes: 0,
  };
  const json = (body: unknown, init: ResponseInit = {}) =>
    new Response(JSON.stringify(body), {
      ...init,
      headers: { "content-type": "application/json", ...init.headers },
    });
  const bodyOf = (request: HttpClientRequest.HttpClientRequest) =>
    request.body._tag === "Uint8Array"
      ? (request.body.text ?? new TextDecoder().decode(request.body.body))
      : "";
  const mcp = (request: HttpClientRequest.HttpClientRequest) => {
    if (request.method === "DELETE") return new Response(null, { status: 200 });
    const message = JSON.parse(bodyOf(request)) as { id?: number; method: string };
    if (message.method === "notifications/initialized") return new Response(null, { status: 202 });
    if (message.method === "initialize") {
      return json(
        { jsonrpc: "2.0", id: message.id, result: { protocolVersion: "2025-06-18" } },
        { headers: { "mcp-session-id": "session-1" } },
      );
    }
    return new Response(
      `event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { tools: [{ name: "a" }, { name: "b" }] } })}\n\n`,
      { headers: { "content-type": "text/event-stream" } },
    );
  };
  const handle = (request: HttpClientRequest.HttpClientRequest): Response => {
    const url = new URL(request.url);
    const href = `${url.origin}${url.pathname}`;
    if (href === OPEN) return mcp(request);
    if (href === ACME) {
      const token = request.headers.authorization?.replace(/^Bearer /, "");
      if (token === undefined || !world.validTokens.has(token)) {
        return new Response(null, {
          status: 401,
          headers: {
            "www-authenticate": `Bearer resource_metadata="https://mcp.acme.test/.well-known/oauth-protected-resource/mcp", scope="read write"`,
          },
        });
      }
      return mcp(request);
    }
    if (href === "https://mcp.acme.test/.well-known/oauth-protected-resource/mcp") {
      return json({ resource: ACME, authorization_servers: ["https://auth.acme.test"] });
    }
    if (href === "https://auth.acme.test/.well-known/oauth-authorization-server") {
      return json({
        issuer: "https://auth.acme.test",
        authorization_endpoint: "https://auth.acme.test/authorize",
        token_endpoint: "https://auth.acme.test/token",
        registration_endpoint: "https://auth.acme.test/register",
        code_challenge_methods_supported: ["S256"],
      });
    }
    if (href === "https://auth.acme.test/register") {
      world.registrations += 1;
      const metadata = JSON.parse(bodyOf(request)) as { redirect_uris: Array<string> };
      expect(metadata.redirect_uris).toEqual([`${ORIGIN}/oauth/connectors/callback`]);
      return json({ client_id: `client-${world.registrations}` }, { status: 201 });
    }
    if (href === GMAIL || href === CALENDAR) {
      const token = request.headers.authorization?.replace(/^Bearer /, "");
      if (token !== undefined && !world.validTokens.has(token)) {
        return new Response(null, { status: 401 });
      }
      return mcp(request);
    }
    if (url.pathname === "/.well-known/oauth-protected-resource/mcp/v1") {
      return json({
        resource: `${url.origin}/mcp/v1`,
        authorization_servers: ["https://accounts.google.com/"],
        scopes_supported: ["https://mail.google.com/", "https://www.googleapis.com/auth/calendar"],
      });
    }
    if (href === "https://accounts.google.com/.well-known/oauth-authorization-server") {
      return json({
        issuer: "https://accounts.google.com",
        authorization_endpoint: "https://accounts.google.com/o/oauth2/v2/auth",
        token_endpoint: "https://oauth2.googleapis.com/token",
        code_challenge_methods_supported: ["plain", "S256"],
        token_endpoint_auth_methods_supported: ["client_secret_post", "client_secret_basic"],
      });
    }
    if (href === "https://oauth2.googleapis.com/token") {
      const basic = `Basic ${btoa(`${GOOGLE_CLIENT.clientId}:${GOOGLE_CLIENT.clientSecret}`)}`;
      if (request.headers.authorization !== basic) {
        return json({ error: "invalid_client" }, { status: 401 });
      }
      const form = new URLSearchParams(bodyOf(request));
      world.issued += 1;
      const accessToken = `ya29-${world.issued}`;
      world.validTokens.add(accessToken);
      if (form.get("grant_type") === "refresh_token") {
        world.googleRefreshes += 1;
        return json({ access_token: accessToken, expires_in: 3599 });
      }
      return json({ access_token: accessToken, refresh_token: "1//rt", expires_in: 3599 });
    }
    if (href === "https://auth.acme.test/token") {
      const form = new URLSearchParams(bodyOf(request));
      if (form.get("resource") !== ACME) return json({ error: "invalid_target" }, { status: 400 });
      const issue = () => {
        world.issued += 1;
        const accessToken = `at-${world.issued}`;
        world.validTokens.add(accessToken);
        return accessToken;
      };
      if (form.get("grant_type") === "authorization_code") {
        const verifier = form.get("code_verifier") ?? "";
        const challenge = NodeCrypto.createHash("sha256").update(verifier).digest("base64url");
        if (world.challenges.get(form.get("code") ?? "") !== challenge) {
          return json({ error: "invalid_grant" }, { status: 400 });
        }
        return json({ access_token: issue(), refresh_token: "rt-1", expires_in: 3600 });
      }
      world.refreshes += 1;
      if (world.refreshFails || form.get("refresh_token") !== "rt-1") {
        return json({ error: "invalid_grant" }, { status: 400 });
      }
      // No new refresh token: the old one stays valid.
      return json({ access_token: issue(), expires_in: 3600 });
    }
    return new Response("not found", { status: 404 });
  };
  /** The user approves in the browser: the server remembers the challenge for the code it issues. */
  const approve = (authorizationUrl: string) => {
    const url = new URL(authorizationUrl);
    const code = `code-${world.challenges.size + 1}`;
    world.challenges.set(code, url.searchParams.get("code_challenge") ?? "");
    return { code, state: url.searchParams.get("state") ?? "" };
  };
  const http = HttpClient.make((request) =>
    Effect.sync(() => HttpClientResponse.fromWeb(request, handle(request))),
  );
  return { world, http, approve };
};

const projectOf = (
  id: ProjectId,
  connectionIds: ReadonlyArray<ConnectorConnectionId>,
): Project => ({
  id,
  title: id,
  workspaceRoot: `/home/user/boops/${id}`,
  defaultModelSelection: null,
  scripts: [],
  connectionIds,
  createdAt: "2026-11-05T00:00:00.000Z",
  updatedAt: "2026-11-05T00:00:00.000Z",
  deletedAt: null,
});

const adapter = {
  instanceId,
  driver,
  getCapabilities: () => Effect.succeed(CodexProviderCapabilitiesV2),
  planSelectionTransition: () => Effect.succeed({ type: "apply_on_next_turn" as const }),
  openSession: () => Effect.die("No provider process needed"),
} as ProviderAdapter.ProviderAdapterV2["Service"];

const makeHarness = Effect.gen(function* () {
  const { world, http, approve } = makeWorld();
  const bots = new Map<ProjectId, Project>([
    [botId, projectOf(botId, [])],
    [otherBotId, projectOf(otherBotId, [])],
  ]);
  const secrets = new Map<string, Uint8Array>();
  const database = yield* SqlitePersistence.layerMemory.pipe(Layer.build);
  const layerDatabase = Layer.succeedContext(database);
  const layerOrchestrator = Layer.mergeAll(
    layerDatabase,
    ProjectionStore.layer.pipe(Layer.provide(layerDatabase)),
    ProviderReplayHarness.layerWithRegistry(
      { name: "connectors" },
      ProviderAdapterRegistry.layerFromAdapters([adapter]),
      { databaseLayer: layerDatabase, runEffectWorker: false },
    ),
  ).pipe(
    Layer.provide(
      Layer.succeed(ProviderContinuationRequests.ProviderContinuationRequests, {
        offer: () => Effect.void,
        take: Effect.never,
      }),
    ),
  );
  const layerThreads = ThreadManagement.layer.pipe(
    Layer.provide(CommandReceiptStore.layer.pipe(Layer.provide(layerDatabase))),
    Layer.provideMerge(Layer.merge(layerOrchestrator, ServerSettings.layerTest())),
  );
  const context = yield* Connectors.layer.pipe(
    Layer.provideMerge(layerThreads),
    Layer.provide(Layer.succeed(HttpClient.HttpClient, http)),
    Layer.provide(
      Layer.mock(ServerSecretStore.ServerSecretStore)({
        get: (name) => Effect.sync(() => Option.fromNullishOr(secrets.get(name))),
        set: (name, value) => Effect.sync(() => void secrets.set(name, value)),
        remove: (name) => Effect.sync(() => void secrets.delete(name)),
      }),
    ),
    Layer.provide(
      Layer.mock(ProjectService.ProjectService)({
        getById: (projectId) => Effect.sync(() => Option.fromNullishOr(bots.get(projectId))),
        update: (input) =>
          Effect.sync(() => {
            const next = {
              ...bots.get(input.projectId)!,
              connectionIds: input.connectionIds,
              ...(input.memberConnectionIds === undefined
                ? {}
                : { memberConnectionIds: input.memberConnectionIds }),
            };
            bots.set(input.projectId, next);
            return next;
          }),
        listShells: () =>
          Effect.sync(() =>
            [...bots.values()].map((project): OrchestrationProjectShell => ({
              id: project.id,
              title: project.title,
              workspaceRoot: project.workspaceRoot,
              defaultModelSelection: null,
              scripts: [],
              connectionIds: project.connectionIds ?? [],
              createdAt: project.createdAt,
              updatedAt: project.updatedAt,
            })),
          ),
      }),
    ),
    Layer.provide(PlatformNodeCrypto.layer),
    Layer.provide(NodeServices.layer),
    Layer.build,
  );
  return {
    world,
    approve,
    bots,
    secrets,
    connectors: Context.get(context, Connectors.Connectors),
    orchestrator: Context.get(context, Orchestrator.OrchestratorV2),
    sink: Context.get(context, EventSink.EventSinkV2),
  };
});
type Harness = Effect.Success<typeof makeHarness>;

/** Signs in to ACME through the OAuth flow, as the card or Settings would. */
const connectAcme = (harness: Harness) =>
  Effect.gen(function* () {
    const started = yield* harness.connectors.startOAuth({
      target: { url: ACME },
      displayName: "Acme (work)",
      redirectOrigin: ORIGIN,
    });
    const connection = yield* harness.connectors.completeOAuth(
      harness.approve(started.authorizationUrl),
    );
    return { started, connection };
  });

/** The bot's thread, mid-turn when it asks. */
const seedThread = (harness: Harness) =>
  Effect.gen(function* () {
    const now = yield* DateTime.now;
    const providerThreadId = ProviderThreadId.make("provider-thread:bot");
    yield* harness.orchestrator.dispatch({
      type: "thread.create",
      createdBy: "user",
      creationSource: "web",
      commandId: CommandId.make("command:create:bot"),
      threadId,
      projectId: botId,
      title: "Bot",
      modelSelection,
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: null,
      worktreePath: null,
    });
    yield* harness.sink.write({
      commandId: CommandId.make("command:seed:bot"),
      events: [
        {
          id: EventId.make("event:seed-provider-thread"),
          type: "provider-thread.updated",
          threadId,
          driver,
          providerInstanceId: instanceId,
          occurredAt: now,
          payload: {
            id: providerThreadId,
            driver,
            providerInstanceId: instanceId,
            providerSessionId: null,
            appThreadId: threadId,
            ownerNodeId: rootNode,
            nativeThreadRef: { driver, nativeId: "native:bot", strength: "strong" },
            nativeConversationHeadRef: null,
            status: "active",
            firstRunOrdinal: 1,
            lastRunOrdinal: 1,
            handoffIds: [],
            forkedFrom: null,
            createdAt: now,
            updatedAt: now,
          },
        },
        {
          id: EventId.make("event:seed-node"),
          type: "node.updated",
          threadId,
          runId,
          nodeId: rootNode,
          driver,
          providerInstanceId: instanceId,
          occurredAt: now,
          payload: {
            id: rootNode,
            threadId,
            runId,
            parentNodeId: null,
            rootNodeId: rootNode,
            kind: "root_turn",
            status: "running",
            countsForRun: true,
            providerThreadId,
            providerTurnId: null,
            nativeItemRef: null,
            runtimeRequestId: null,
            checkpointScopeId: null,
            startedAt: now,
            completedAt: null,
          },
        },
        {
          id: EventId.make("event:seed-run"),
          type: "run.updated",
          threadId,
          runId,
          nodeId: rootNode,
          providerInstanceId: instanceId,
          occurredAt: now,
          payload: {
            id: runId,
            threadId,
            ordinal: 1,
            providerInstanceId: instanceId,
            modelSelection,
            providerThreadId,
            userMessageId: MessageId.make("message:seed-user"),
            rootNodeId: rootNode,
            activeAttemptId: null,
            status: "running",
            requestedAt: now,
            startedAt: now,
            completedAt: null,
            checkpointId: null,
            contextHandoffId: null,
          },
        },
      ],
    });
  });

const cards = (harness: Harness) =>
  harness.orchestrator
    .getThreadProjection(threadId)
    .pipe(
      Effect.map((projection) =>
        projection.turnItems.flatMap((item) => (item.type === "connection_request" ? [item] : [])),
      ),
    );
const notices = (harness: Harness) =>
  harness.orchestrator
    .getThreadProjection(threadId)
    .pipe(
      Effect.map((projection) =>
        projection.messages.filter((message) => message.notification !== undefined),
      ),
    );

it.effect(
  "signs in with OAuth: discovery, one client registration per server and redirect, PKCE and resource",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const harness = yield* makeHarness;
        const { started, connection } = yield* connectAcme(harness);
        const url = new URL(started.authorizationUrl);
        expect(`${url.origin}${url.pathname}`).toBe("https://auth.acme.test/authorize");
        expect(Object.fromEntries(url.searchParams)).toMatchObject({
          response_type: "code",
          client_id: "client-1",
          redirect_uri: `${ORIGIN}/oauth/connectors/callback`,
          code_challenge_method: "S256",
          resource: ACME,
          scope: "read write",
        });
        expect(connection).toMatchObject({
          id: started.connectionId,
          displayName: "Acme (work)",
          authKind: "oauth",
          status: "connected",
          toolCount: 2,
        });
        expect(connection.serverName).toMatch(/^acme_[a-z0-9]{6}$/);
        // A second connection to the same server reuses the registered client.
        yield* connectAcme(harness);
        expect(harness.world.registrations).toBe(1);
        expect((yield* harness.connectors.list).connections).toHaveLength(2);
        // A replayed callback finds no flow.
        const replayed = yield* harness.connectors
          .completeOAuth({ state: new URL(started.authorizationUrl).searchParams.get("state")! })
          .pipe(Effect.flip);
        expect(replayed.reason).toBe("oauth_failed");
      }),
    ),
);

it.effect(
  "signs in to Google with the user's own OAuth client, reused across connections and sign-ins",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const harness = yield* makeHarness;
        const gmail = { target: { catalogId: "gmail" }, redirectOrigin: ORIGIN } as const;
        const asked = yield* harness.connectors.startOAuth(gmail).pipe(Effect.flip);
        expect(asked).toMatchObject({
          reason: "oauth_client_required",
          detail: "accounts.google.com",
        });
        const started = yield* harness.connectors.startOAuth({ ...gmail, client: GOOGLE_CLIENT });
        const url = new URL(started.authorizationUrl);
        expect(`${url.origin}${url.pathname}`).toBe("https://accounts.google.com/o/oauth2/v2/auth");
        expect(Object.fromEntries(url.searchParams)).toMatchObject({
          client_id: GOOGLE_CLIENT.clientId,
          redirect_uri: `${ORIGIN}/oauth/connectors/callback`,
          resource: GMAIL,
          scope:
            "https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/gmail.compose",
          access_type: "offline",
          prompt: "consent",
        });
        const connection = yield* harness.connectors.completeOAuth(
          harness.approve(started.authorizationUrl),
        );
        expect(connection).toMatchObject({ authKind: "oauth", status: "connected", toolCount: 2 });
        // The secret stays in the secret store, never in the connection or its server info.
        expect(JSON.stringify((yield* harness.connectors.list).connections)).not.toContain(
          "GOCSPX",
        );

        // Another Google product reuses the client without asking.
        const calendar = yield* harness.connectors.startOAuth({
          target: { catalogId: "google-calendar" },
          redirectOrigin: ORIGIN,
        });
        expect(new URL(calendar.authorizationUrl).searchParams.get("client_id")).toBe(
          GOOGLE_CLIENT.clientId,
        );

        // Refresh authenticates with the stored secret.
        yield* seedThread(harness);
        yield* harness.connectors.setBotConnection({
          projectId: botId,
          connectionId: connection.id,
          enabled: true,
        });
        yield* TestClock.adjust(Duration.seconds(3570));
        const upstream = yield* harness.connectors.upstream({
          threadId,
          serverName: connection.serverName,
        });
        expect(upstream.headers).toEqual({ authorization: "Bearer ya29-2" });
        expect(harness.world.googleRefreshes).toBe(1);

        // Disconnecting signs out but keeps the client, so signing in again doesn't ask for it.
        yield* harness.connectors.disconnect(connection.id);
        const again = yield* harness.connectors.reauthenticate({
          connectionId: connection.id,
          credential: { type: "oauth", redirectOrigin: ORIGIN },
        });
        expect(new URL(again.authorizationUrl!).searchParams.get("client_id")).toBe(
          GOOGLE_CLIENT.clientId,
        );
        const reconnected = yield* harness.connectors.completeOAuth(
          harness.approve(again.authorizationUrl!),
        );
        expect(reconnected).toMatchObject({ id: connection.id, status: "connected" });
      }),
    ),
);

it.effect("refreshes a token near expiry, and a failed refresh means needs_auth", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness;
      yield* seedThread(harness);
      const { connection } = yield* connectAcme(harness);
      const upstream = harness.connectors.upstream({ threadId, serverName: connection.serverName });
      // Off for this bot: the proxy refuses it.
      expect((yield* upstream.pipe(Effect.flip)).reason).toBe("not_connected");
      yield* harness.connectors.setBotConnection({
        projectId: botId,
        connectionId: connection.id,
        enabled: true,
      });
      expect((yield* upstream).headers).toEqual({ authorization: "Bearer at-1" });
      // A member's conversation in the same bot never reaches the owner's accounts.
      const memberThreadId = ThreadId.make("thread:bot:member");
      yield* harness.orchestrator.dispatch({
        type: "thread.create",
        createdBy: "user",
        creationSource: "server",
        commandId: CommandId.make("command:create:bot:member"),
        threadId: memberThreadId,
        projectId: botId,
        title: "Bot",
        modelSelection,
        runtimeMode: "auto-accept-edits",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        linkOrigin: {
          sessionId: "member:anna",
          label: "Anna",
          access: "auto-accept-edits",
          memberId: EnvironmentMemberId.make("anna"),
        },
      });
      const memberUpstream = harness.connectors.upstream({
        threadId: memberThreadId,
        serverName: connection.serverName,
      });
      expect((yield* memberUpstream.pipe(Effect.flip)).reason).toBe("not_connected");
      // Shared with members for this bot, it reaches her conversation too.
      harness.bots.set(botId, {
        ...harness.bots.get(botId)!,
        memberConnectionIds: [connection.id],
      });
      expect((yield* memberUpstream).headers).toEqual({ authorization: "Bearer at-1" });
      expect(harness.world.refreshes).toBe(0);
      yield* TestClock.adjust(Duration.seconds(3570));
      expect((yield* upstream).headers).toEqual({ authorization: "Bearer at-2" });
      expect(harness.world.refreshes).toBe(1);
      harness.world.refreshFails = true;
      yield* TestClock.adjust(Duration.seconds(3570));
      expect((yield* upstream.pipe(Effect.flip)).reason).toBe("not_connected");
      const [after] = (yield* harness.connectors.list).connections;
      expect(after).toMatchObject({ status: "needs_auth", statusDetail: "Sign-in expired" });
      // Signing in again brings it back.
      const again = yield* harness.connectors.reauthenticate({
        connectionId: connection.id,
        credential: { type: "oauth", redirectOrigin: ORIGIN },
      });
      harness.world.refreshFails = false;
      const reconnected = yield* harness.connectors.completeOAuth(
        harness.approve(again.authorizationUrl!),
      );
      expect(reconnected).toMatchObject({ id: connection.id, status: "connected" });
      // A credential lost from the secret store (a copied home) means needs_auth too.
      harness.secrets.delete(`connector-${connection.id}`);
      expect((yield* upstream.pipe(Effect.flip)).reason).toBe("not_connected");
      const [missing] = (yield* harness.connectors.list).connections;
      expect(missing).toMatchObject({ status: "needs_auth", statusDetail: "Sign-in missing" });
    }),
  ),
);

it.effect("a connection card: retry by clientRequestId, use-existing resolves and wakes", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness;
      yield* seedThread(harness);
      const { catalog } = yield* harness.connectors.listForCaller(scope);
      // Bots learn which connectors need the user to create an OAuth client first.
      expect(catalog.find((entry) => entry.catalogId === "gmail")?.setup).toContain("OAuth client");
      expect(catalog.find((entry) => entry.catalogId === "linear")?.setup).toBeUndefined();
      const ask = { url: OPEN, reason: "To read your tickets.", clientRequestId: "ask-1" };
      const shown = yield* harness.connectors.requestConnection(scope, ask);
      expect(shown.status).toBe("card_shown");
      expect(yield* harness.connectors.requestConnection(scope, ask)).toEqual(shown);
      expect(yield* cards(harness)).toMatchObject([
        { id: shown.turnItemId, status: "waiting", connectionStatus: "pending", url: OPEN },
      ]);
      const open = yield* harness.connectors.addConnection({
        target: { url: OPEN },
        credential: { type: "none" },
      });
      expect(open).toMatchObject({ authKind: "none", status: "connected", toolCount: 2 });
      yield* harness.connectors.answerRequest({
        threadId,
        turnItemId: shown.turnItemId!,
        answer: { type: "use-existing", connectionId: open.id },
      });
      expect(harness.bots.get(botId)?.connectionIds).toEqual([open.id]);
      expect(yield* cards(harness)).toMatchObject([
        { status: "completed", connectionStatus: "connected", connectionId: open.id },
      ]);
      const [notice] = yield* notices(harness);
      expect(notice?.text).toContain(`MCP server ${open.serverName}`);
      // Answered once.
      const again = yield* harness.connectors
        .answerRequest({ threadId, turnItemId: shown.turnItemId!, answer: { type: "decline" } })
        .pipe(Effect.flip);
      expect(again.reason).toBe("request_already_answered");
      // Usable now: no second card.
      expect(
        yield* harness.connectors.requestConnection(scope, { url: OPEN, reason: "Again." }),
      ).toEqual({ status: "already_connected", serverName: open.serverName });
      expect(yield* cards(harness)).toHaveLength(1);
    }),
  ),
);

it.effect("a declined card tells the bot; connecting from a card turns it on and closes it", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness;
      yield* seedThread(harness);
      const declined = yield* harness.connectors.requestConnection(scope, {
        catalogId: "notion",
        reason: "To read your notes.",
      });
      yield* harness.connectors.answerRequest({
        threadId,
        turnItemId: declined.turnItemId!,
        answer: { type: "decline" },
      });
      const asked = yield* harness.connectors.requestConnection(scope, {
        url: ACME,
        reason: "To file issues.",
      });
      const started = yield* harness.connectors.startOAuth({
        target: { url: ACME },
        redirectOrigin: ORIGIN,
        forRequest: { threadId, turnItemId: asked.turnItemId! },
      });
      yield* harness.connectors.completeOAuth(harness.approve(started.authorizationUrl));
      expect(harness.bots.get(botId)?.connectionIds).toEqual([started.connectionId]);
      expect(yield* cards(harness)).toMatchObject([
        { id: declined.turnItemId, connectionStatus: "declined", status: "cancelled" },
        { id: asked.turnItemId, connectionStatus: "connected", connectionId: started.connectionId },
      ]);
      expect(
        (yield* notices(harness)).map((message) => message.notification?.summary).toSorted(),
      ).toEqual(["Connected mcp.acme.test", "Declined to connect Notion"]);
    }),
  ),
);

it.effect("removing a connection turns it off for every bot and forgets its credentials", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const harness = yield* makeHarness;
      const { connection } = yield* connectAcme(harness);
      for (const projectId of [botId, otherBotId]) {
        yield* harness.connectors.setBotConnection({
          projectId,
          connectionId: connection.id,
          enabled: true,
        });
      }
      harness.bots.set(botId, {
        ...harness.bots.get(botId)!,
        memberConnectionIds: [connection.id],
      });
      const disconnected = yield* harness.connectors.disconnect(connection.id);
      expect(disconnected).toMatchObject({ status: "needs_auth", statusDetail: "Disconnected" });
      expect(harness.secrets.has(`connector-${connection.id}`)).toBe(false);
      // Disconnecting keeps it on for its bots, to sign in again later.
      expect(harness.bots.get(otherBotId)?.connectionIds).toEqual([connection.id]);
      yield* harness.connectors.remove(connection.id);
      expect(harness.bots.get(botId)?.connectionIds).toEqual([]);
      // Members lose it with the bot, so turning it on again doesn't hand it back to them.
      expect(harness.bots.get(botId)?.memberConnectionIds).toEqual([]);
      expect(harness.bots.get(otherBotId)?.connectionIds).toEqual([]);
      expect((yield* harness.connectors.list).connections).toEqual([]);
      expect(
        (yield* harness.connectors
          .remove(ConnectorConnectionId.make(connection.id))
          .pipe(Effect.flip)).reason,
      ).toBe("unknown_connection");
    }),
  ),
);

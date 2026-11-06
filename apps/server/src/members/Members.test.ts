import * as PlatformNodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  CommandId,
  EnvironmentId,
  type OrchestrationProjectShell,
  type Project,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import { expect, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as ProviderContinuationRequests from "@t3tools/provider-core/server/ProviderContinuationRequests";
import type * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as SessionStore from "../auth/SessionStore.ts";
import { RELAY_ENVIRONMENT_CREDENTIAL_SECRET, RELAY_URL_SECRET } from "../cloud/config.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import { CodexProviderCapabilitiesV2 } from "../orchestration-v2/Adapters/CodexAdapterV2.ts";
import * as CommandReceiptStore from "../orchestration-v2/CommandReceiptStore.ts";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ProviderAdapterRegistry from "../orchestration-v2/ProviderAdapterRegistry.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as ProviderReplayHarness from "../orchestration-v2/testkit/ProviderReplayHarness.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as Members from "./Members.ts";

const instanceId = ProviderInstanceId.make("codex");
const modelSelection = { instanceId, model: "gpt-5.4" };
const botId = ProjectId.make("project:bot");
const mainThreadId = ThreadId.make("thread:bot-main");

const adapter = {
  instanceId,
  driver: ProviderDriverKind.make("codex"),
  getCapabilities: () => Effect.succeed(CodexProviderCapabilitiesV2),
  planSelectionTransition: () => Effect.succeed({ type: "apply_on_next_turn" as const }),
  openSession: () => Effect.die("No provider process needed"),
} as ProviderAdapter.ProviderAdapterV2["Service"];

const encode = (value: string) => new TextEncoder().encode(value);

const makeHarness = Effect.gen(function* () {
  const bots = new Map<ProjectId, Project>([
    [
      botId,
      {
        id: botId,
        title: "Pip",
        workspaceRoot: "/home/user/boops/pip",
        defaultModelSelection: modelSelection,
        scripts: [],
        mainThreadId,
        avatar: null,
        memberIds: [],
        createdAt: "2026-11-05T00:00:00.000Z",
        updatedAt: "2026-11-05T00:00:00.000Z",
        deletedAt: null,
      },
    ],
  ]);
  const relayCalls: Array<{
    readonly method: string;
    readonly url: string;
    readonly body: unknown;
  }> = [];
  const revokedSubjects: Array<string> = [];
  const fetch: typeof globalThis.fetch = Object.assign(
    (input: Parameters<typeof globalThis.fetch>[0], init?: RequestInit) => {
      relayCalls.push({
        method: init?.method ?? "GET",
        url: String(input instanceof Request ? input.url : input),
        body: init?.body === undefined || init.body === null ? null : JSON.parse(String(init.body)),
      });
      return Promise.resolve(Response.json({ ok: true }));
    },
    { preconnect: () => {} },
  );

  const database = yield* SqlitePersistence.layerMemory.pipe(Layer.build);
  const layerDatabase = Layer.succeedContext(database);
  const layerOrchestrator = Layer.mergeAll(
    layerDatabase,
    ProjectionStore.layer.pipe(Layer.provide(layerDatabase)),
    ProviderReplayHarness.layerWithRegistry(
      { name: "members" },
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
  const context = yield* Members.layer.pipe(
    Layer.provideMerge(layerThreads),
    Layer.provide(
      Layer.mock(ServerSecretStore.ServerSecretStore)({
        get: (name) =>
          Effect.succeed(
            name === RELAY_URL_SECRET
              ? Option.some(encode("https://relay.test"))
              : name === RELAY_ENVIRONMENT_CREDENTIAL_SECRET
                ? Option.some(encode("environment-credential"))
                : Option.none(),
          ),
      }),
    ),
    Layer.provide(
      Layer.mock(SessionStore.SessionStore)({
        cookieName: "members-test",
        legacyCookieName: undefined,
        revokeSubject: (subject) => Effect.sync(() => revokedSubjects.push(subject)),
      }),
    ),
    Layer.provide(
      Layer.mock(ServerEnvironment.ServerEnvironment)({
        getEnvironmentId: Effect.succeed(EnvironmentId.make("environment-1")),
        getDescriptor: Effect.succeed({
          environmentId: EnvironmentId.make("environment-1"),
          label: "Peter's Boops",
          platform: { os: "darwin", arch: "arm64" },
          serverVersion: "0.0.0-test",
          capabilities: { repositoryIdentity: false },
        }),
      }),
    ),
    Layer.provide(
      Layer.mock(ProjectService.ProjectService)({
        getById: (projectId) => Effect.sync(() => Option.fromNullishOr(bots.get(projectId))),
        update: (input) =>
          Effect.sync(() => {
            const next = { ...bots.get(input.projectId)!, memberIds: input.memberIds };
            bots.set(input.projectId, next);
            return next;
          }),
        listShells: () =>
          Effect.sync(() =>
            [...bots.values()].map((project): OrchestrationProjectShell => ({
              id: project.id,
              title: project.title,
              workspaceRoot: project.workspaceRoot,
              defaultModelSelection: project.defaultModelSelection,
              scripts: [],
              memberIds: project.memberIds ?? [],
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
  const threads = Context.get(context, ThreadManagement.ThreadManagementService);
  yield* Context.get(context, Orchestrator.OrchestratorV2).dispatch({
    type: "thread.create",
    createdBy: "user",
    creationSource: "server",
    commandId: CommandId.make("command:create:bot-main"),
    threadId: mainThreadId,
    projectId: botId,
    title: "Pip",
    modelSelection,
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
  });
  const withFetch = Effect.provideService(FetchHttpClient.Fetch, fetch);
  return {
    bots,
    relayCalls,
    revokedSubjects,
    members: Context.get(context, Members.Members),
    withFetch,
    memberThreads: threads
      .listProjectThreads({ projectId: botId, includeSubagents: true })
      .pipe(Effect.map((all) => all.filter((thread) => thread.linkOrigin?.memberId !== undefined))),
  };
});

it.effect("an invite shares the bot with a stamped conversation of its own", () =>
  Effect.gen(function* () {
    const harness = yield* makeHarness;
    const anna = yield* harness.members
      .invite({ email: " Anna@Example.com ", label: "Anna", projectIds: [botId] })
      .pipe(harness.withFetch);

    expect(anna).toMatchObject({ email: "anna@example.com", status: "invited" });
    expect(harness.relayCalls).toEqual([
      {
        method: "PUT",
        url: `https://relay.test/v1/environments/environment-1/members/${anna.id}`,
        body: {
          email: "anna@example.com",
          memberLabel: "Anna",
          environmentLabel: "Peter's Boops",
        },
      },
    ]);
    expect(harness.bots.get(botId)?.memberIds).toEqual([anna.id]);
    const [conversation, ...extra] = yield* harness.memberThreads;
    expect(extra).toEqual([]);
    expect(conversation).toMatchObject({
      title: "Pip",
      modelSelection,
      // The bot runs with full access; Anna's conversation never runs above her access.
      runtimeMode: "auto-accept-edits",
      linkOrigin: {
        sessionId: `member:${anna.id}`,
        label: "Anna",
        access: "auto-accept-edits",
        memberId: anna.id,
      },
    });

    // Sharing again, or after turning it off and on, keeps the one conversation.
    yield* harness.members.setBotAccess({ projectId: botId, memberId: anna.id, enabled: false });
    expect(harness.bots.get(botId)?.memberIds).toEqual([]);
    yield* harness.members.setBotAccess({ projectId: botId, memberId: anna.id, enabled: true });
    expect((yield* harness.memberThreads).map((thread) => thread.id)).toEqual([conversation!.id]);

    const again = yield* harness.members
      .invite({ email: "anna@example.com", label: "Anna", projectIds: [] })
      .pipe(harness.withFetch, Effect.flip);
    expect(again.reason).toBe("already-member");
  }),
);

it.effect("removing a member signs them out, unshares their bots and archives their threads", () =>
  Effect.gen(function* () {
    const harness = yield* makeHarness;
    const anna = yield* harness.members
      .invite({ email: "anna@example.com", label: "Anna", projectIds: [botId] })
      .pipe(harness.withFetch);
    yield* harness.members.authorizeMint({ cloudUserId: "anna-user", memberId: anna.id });
    expect(
      Option.getOrThrow(yield* harness.members.get(anna.id)).status,
      "first mint binds her Connect user",
    ).toBe("active");
    expect(
      yield* harness.members.authorizeMint({ cloudUserId: "someone-else", memberId: anna.id }),
    ).toEqual(Option.none());

    yield* harness.members.leave(`member:${anna.id}`).pipe(harness.withFetch);

    expect(harness.revokedSubjects).toEqual([`member:${anna.id}`]);
    expect(harness.relayCalls.at(-1)).toMatchObject({
      method: "DELETE",
      url: `https://relay.test/v1/environments/environment-1/members/${anna.id}`,
    });
    expect(harness.bots.get(botId)?.memberIds).toEqual([]);
    expect(yield* harness.memberThreads).toEqual([]);
    expect((yield* harness.members.list).members).toEqual([]);
    expect(
      yield* harness.members.authorizeMint({ cloudUserId: "anna-user", memberId: anna.id }),
    ).toEqual(Option.none());
  }),
);

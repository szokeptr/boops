import * as PlatformNodeCrypto from "@effect/platform-node/NodeCrypto";
import { expect, it } from "@effect/vitest";
import { ProjectId, SecretVaultEntryName, type Project } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as SecretVaults from "./SecretVaults.ts";

const assistant = ProjectId.make("project:assistant");
const coder = ProjectId.make("project:coder");
const homeAssistant = SecretVaultEntryName.make("home-assistant");

const makeHarness = Effect.gen(function* () {
  const values = new Map<string, Uint8Array>();
  const bots = new Map([
    [assistant, { id: assistant, title: "Assistant" } as Project],
    [coder, { id: coder, title: "Coder" } as Project],
  ]);
  const context = yield* SecretVaults.layer.pipe(
    Layer.provide(SqlitePersistence.layerMemory),
    Layer.provide(
      Layer.mock(ServerSecretStore.ServerSecretStore)({
        get: (name) => Effect.sync(() => Option.fromNullishOr(values.get(name))),
        set: (name, value) => Effect.sync(() => void values.set(name, value)),
        remove: (name) => Effect.sync(() => void values.delete(name)),
      }),
    ),
    Layer.provide(
      Layer.mock(ProjectService.ProjectService)({
        getById: (projectId) => Effect.sync(() => Option.fromNullishOr(bots.get(projectId))),
      }),
    ),
    Layer.provide(PlatformNodeCrypto.layer),
    Layer.build,
  );
  return { vaults: Context.get(context, SecretVaults.SecretVaults), values };
});

const readValue = (
  vaults: SecretVaults.SecretVaults["Service"],
  projectId: ProjectId,
  name = homeAssistant,
) => vaults.read({ projectId, name }).pipe(Effect.map(Option.getOrUndefined));

it.effect("a bot's first kept secret makes it a vault that only it can read", () =>
  Effect.gen(function* () {
    const { vaults } = yield* makeHarness;
    const keptIn = yield* vaults.keep({
      projectId: assistant,
      vaultId: null,
      name: homeAssistant,
      label: "Home Assistant token",
      value: "token-1",
    });
    expect(keptIn).toBe("Assistant");
    expect(yield* readValue(vaults, assistant)).toBe("token-1");
    expect(yield* readValue(vaults, coder)).toBeUndefined();

    const { vaults: listed } = yield* vaults.snapshot;
    expect(listed).toHaveLength(1);
    expect(listed[0]?.projectIds).toEqual([assistant]);
    expect(listed[0]?.entries[0]?.lastUsedAt).not.toBeNull();
    expect(JSON.stringify(listed)).not.toContain("token-1");
  }),
);

it.effect("keeping a name again replaces the value where it already lives", () =>
  Effect.gen(function* () {
    const { vaults } = yield* makeHarness;
    yield* vaults.keep({
      projectId: assistant,
      vaultId: null,
      name: homeAssistant,
      label: "Home Assistant token",
      value: "token-1",
    });
    const shared = yield* vaults.create({ name: "Household", projectIds: [assistant] });
    yield* vaults.keep({
      projectId: assistant,
      vaultId: shared,
      name: homeAssistant,
      label: "Home Assistant token",
      value: "token-2",
    });
    expect(yield* readValue(vaults, assistant)).toBe("token-2");
    const { vaults: listed } = yield* vaults.snapshot;
    expect(listed.find((vault) => vault.id === shared)?.entries).toEqual([]);
  }),
);

it.effect("a bot with several vaults has to be told which one keeps a new secret", () =>
  Effect.gen(function* () {
    const { vaults } = yield* makeHarness;
    yield* vaults.create({ name: "Private", projectIds: [assistant] });
    yield* vaults.create({ name: "Household", projectIds: [assistant] });
    const exit = yield* vaults
      .keep({
        projectId: assistant,
        vaultId: null,
        name: homeAssistant,
        label: "Home Assistant token",
        value: "token-1",
      })
      .pipe(Effect.exit);
    expect(Exit.isFailure(exit) && JSON.stringify(exit.cause)).toContain("vault_required");
  }),
);

it.effect("a shared vault reaches every bot granted it, until the grant or vault goes", () =>
  Effect.gen(function* () {
    const { vaults, values } = yield* makeHarness;
    const shared = yield* vaults.create({ name: "Household", projectIds: [assistant, coder] });
    yield* vaults.putEntry({
      vaultId: shared,
      name: homeAssistant,
      label: "Home Assistant token",
      value: "token-1",
    });
    expect(yield* readValue(vaults, coder)).toBe("token-1");
    expect((yield* vaults.forBot(coder)).map((secret) => secret.vault)).toEqual(["Household"]);

    yield* vaults.setBot({ vaultId: shared, projectId: coder, enabled: false });
    expect(yield* readValue(vaults, coder)).toBeUndefined();
    expect(yield* readValue(vaults, assistant)).toBe("token-1");

    yield* vaults.remove(shared);
    expect(yield* readValue(vaults, assistant)).toBeUndefined();
    expect([...values.keys()]).toEqual([]);
  }),
);

it.effect("removing an entry deletes its value", () =>
  Effect.gen(function* () {
    const { vaults, values } = yield* makeHarness;
    const vaultId = yield* vaults.create({ name: "Private", projectIds: [assistant] });
    yield* vaults.putEntry({ vaultId, name: homeAssistant, label: "HA", value: "token-1" });
    const { vaults: listed } = yield* vaults.snapshot;
    yield* vaults.removeEntry(listed[0]!.entries[0]!.id);
    expect(yield* readValue(vaults, assistant)).toBeUndefined();
    expect(values.size).toBe(0);
  }),
);

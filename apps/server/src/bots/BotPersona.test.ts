import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { ProjectId, type Project } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as ProjectService from "../project/ProjectService.ts";
import { makeRefresh, PERSONA_FILE } from "./BotPersona.ts";

const projectId = ProjectId.make("bot");

it.effect("records a persona when the bot writes one and when it goes away, once each", () =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const home = yield* fileSystem.makeTempDirectoryScoped({ prefix: "boops-persona-" });
    let project = {
      id: projectId,
      title: "Bot",
      workspaceRoot: home,
      personaReady: false,
    } as Project;
    const updates: Array<{
      readonly commandId: string;
      readonly personaReady: boolean | undefined;
    }> = [];
    const projects = Layer.mock(ProjectService.ProjectService)({
      getById: () => Effect.succeedSome(project),
      update: (input) =>
        Effect.sync(() => {
          updates.push({ commandId: input.commandId, personaReady: input.personaReady });
          project = { ...project, personaReady: input.personaReady ?? false };
          return project;
        }),
    });
    const refresh = yield* makeRefresh.pipe(Effect.provide(projects));

    yield* refresh(projectId, "run:1");
    yield* fileSystem.writeFileString(path.join(home, PERSONA_FILE), "# Bot\n");
    yield* refresh(projectId, "run:2");
    yield* refresh(projectId, "run:3");
    yield* fileSystem.remove(path.join(home, PERSONA_FILE));
    yield* refresh(projectId, "run:4");

    assert.deepStrictEqual(updates, [
      { commandId: "bot-persona:bot:run:2", personaReady: true },
      { commandId: "bot-persona:bot:run:4", personaReady: false },
    ]);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

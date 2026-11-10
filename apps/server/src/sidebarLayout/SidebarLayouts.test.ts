import { assert, it } from "@effect/vitest";
import { EnvironmentMemberId, SidebarSectionId, type SidebarLayout } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";

import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as SidebarLayouts from "./SidebarLayouts.ts";

const anna = EnvironmentMemberId.make("member-anna");
const layer = SidebarLayouts.layer.pipe(Layer.provide(SqlitePersistence.layerMemory));

const layoutWith = (title: string): SidebarLayout => ({
  sections: [
    { id: SidebarSectionId.make("s1"), title, collapsed: false, items: ["bot:env:project-1"] },
  ],
});

it.effect("keeps each viewer's layout apart and pushes changes to their other clients", () =>
  Effect.gen(function* () {
    const layouts = yield* SidebarLayouts.SidebarLayouts;
    const ownerUpdates = yield* Queue.unbounded<SidebarLayout>();
    const fiber = yield* layouts.subscribe(undefined).pipe(
      Stream.runForEach((layout) => Queue.offer(ownerUpdates, layout)),
      Effect.forkScoped,
    );
    assert.deepEqual(yield* Queue.take(ownerUpdates), { sections: [] });

    // Anna's change reaches only Anna; the owner's next update is their own.
    yield* layouts.set(anna, layoutWith("Anna's"));
    yield* layouts.set(undefined, layoutWith("Work"));
    assert.deepEqual(yield* Queue.take(ownerUpdates), layoutWith("Work"));
    assert.deepEqual(yield* layouts.subscribe(anna).pipe(Stream.take(1), Stream.runCollect), [
      layoutWith("Anna's"),
    ]);
    yield* Fiber.interrupt(fiber);
  }).pipe(Effect.scoped, Effect.provide(layer)),
);

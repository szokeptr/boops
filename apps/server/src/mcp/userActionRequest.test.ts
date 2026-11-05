import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { McpSchema } from "effect/ai";

import { approveChildBot, requestUserAction } from "./userActionRequest.ts";

const input = {
  title: "Log in to Acme Supplies",
  reason: "The invoice download needs your passkey.",
  url: "https://portal.acme-supplies.example/login",
};

const clientInfo = { name: "harness", version: "1.0.0" };

const harness = (options: {
  readonly elicitation: boolean;
  readonly action?: "accept" | "decline";
  readonly asked?: Array<string>;
}) =>
  Layer.mock(McpSchema.McpServerClient)({
    clientId: 1,
    protocolVersion: "2025-06-18",
    clientInfo,
    initializePayload: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo },
    clientCapabilities: options.elicitation ? { elicitation: {} } : {},
    getClient: Effect.succeed({
      listRoots: () => Effect.die("unused"),
      createMessage: () => Effect.die("unused"),
      elicit: (request) => {
        options.asked?.push(request.message);
        return Effect.succeed({ action: options.action ?? "accept", content: {} });
      },
    } as McpSchema.McpReverseClient),
  });

it.effect("maps the card's answer to done or declined, and a child bot's to approved or not", () =>
  Effect.gen(function* () {
    const asked: Array<string> = [];
    const done = yield* requestUserAction(input).pipe(
      Effect.provide(harness({ elicitation: true, asked })),
    );
    assert.deepEqual(done, { status: "done" });
    assert.include(asked[0], input.url);
    const declined = yield* requestUserAction(input).pipe(
      Effect.provide(harness({ elicitation: true, action: "decline" })),
    );
    assert.deepEqual(declined, { status: "declined" });

    const brief = "You are Pace, Dana's marathon coach.";
    const child = { parentName: "Wren", childName: "Pace", mode: "brief", brief } as const;
    assert.isTrue(
      yield* approveChildBot(child).pipe(Effect.provide(harness({ elicitation: true, asked }))),
    );
    assert.include(asked[1], "Pace");
    assert.include(asked[1], brief);
    assert.isFalse(
      yield* approveChildBot(child).pipe(
        Effect.provide(harness({ elicitation: true, action: "decline" })),
      ),
    );
  }),
);

it.effect("tells the agent to ask in chat when its harness shows no card", () =>
  Effect.gen(function* () {
    const failure = yield* requestUserAction(input).pipe(
      Effect.provide(harness({ elicitation: false })),
      Effect.flip,
    );
    assert.equal(failure.code, "provider_unavailable");
    const sessionless = yield* requestUserAction(input).pipe(Effect.flip);
    assert.equal(sessionless.code, "provider_unavailable");
  }),
);

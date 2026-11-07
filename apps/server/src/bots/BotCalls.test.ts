import { assert, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  type OrchestrationV2Run,
  type Project,
  ProjectId,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import * as SecretResolver from "@t3tools/secret-provider-core/server/SecretResolver";
import * as ConfigProvider from "effect/ConfigProvider";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import { HttpClient, HttpClientResponse } from "effect/http";
import * as Socket from "effect/socket/Socket";

import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as BotCalls from "./BotCalls.ts";

const botId = ProjectId.make("wren");
const threadId = ThreadId.make("wren-main");
const runId = RunId.make("run-1");

/** OpenAI's side of the sideband socket: what the server sent, and a way to send it events. */
class FakeLiveSocket extends EventTarget {
  readyState = 0;
  readonly url: string;
  readonly sent: Queue.Queue<Record<string, unknown>>;
  constructor(url: string, sent: Queue.Queue<Record<string, unknown>>) {
    super();
    this.url = url;
    this.sent = sent;
    queueMicrotask(() => {
      this.readyState = 1;
      this.dispatchEvent(new Event("open"));
    });
  }
  send(data: string) {
    const event = JSON.parse(data) as Record<string, unknown>;
    Queue.offerUnsafe(this.sent, event);
    if (event.type === "session.close") {
      queueMicrotask(() => {
        this.emit({ type: "session.closed", reason: "close_requested" });
        this.close();
      });
    }
  }
  emit(event: Record<string, unknown>) {
    this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(event) }));
  }
  close() {
    if (this.readyState >= 2) return;
    this.readyState = 3;
    this.dispatchEvent(new CloseEvent("close", { code: 1000 }));
  }
}

const harness = Effect.fn(function* (openaiApiKey: string) {
  const fs = yield* FileSystem.FileSystem;
  const home = yield* fs.makeTempDirectoryScoped();
  yield* fs.writeFileString(`${home}/PERSONA.md`, "Wren: dry humour, keeps it short.");
  const sent = yield* Queue.unbounded<Record<string, unknown>>();
  const socket = yield* Deferred.make<FakeLiveSocket>();
  const messages = yield* Queue.unbounded<ThreadManagementService.ThreadManagementSendInput>();
  const runSettled = yield* Deferred.make<OrchestrationV2Run>();
  const sessions: Array<Record<string, unknown>> = [];

  const http = HttpClient.make((request) =>
    Effect.sync(() => {
      const bytes = (request.body as { readonly body?: Uint8Array }).body;
      const body = JSON.parse(new TextDecoder().decode(bytes)) as {
        session: Record<string, unknown>;
        transport: { sdp: string };
      };
      sessions.push(body.session);
      return HttpClientResponse.fromWeb(
        request,
        Response.json(
          {
            session: { id: "live_1" },
            transport: { type: "webrtc", sdp: `answer-for:${body.transport.sdp}` },
          },
          { status: 201 },
        ),
      );
    }),
  );
  const bot = {
    id: botId,
    title: "Wren",
    workspaceRoot: home,
    mainThreadId: threadId,
  } as Project;
  const run = (status: OrchestrationV2Run["status"]) =>
    ({ id: runId, status }) as OrchestrationV2Run;

  const layer = BotCalls.layer.pipe(
    Layer.provide(Layer.succeed(HttpClient.HttpClient, http)),
    Layer.provide(
      Layer.succeed(Socket.WebSocketConstructor, (url) => {
        const fake = new FakeLiveSocket(url, sent);
        Deferred.doneUnsafe(socket, Effect.succeed(fake));
        return fake as unknown as globalThis.WebSocket;
      }),
    ),
    Layer.provide(
      Layer.mock(ProjectService.ProjectService)({
        getById: (id) => Effect.succeed(id === botId ? Option.some(bot) : Option.none()),
      }),
    ),
    Layer.provide(
      Layer.mock(ThreadManagementService.ThreadManagementService)({
        getThreadShell: () =>
          Effect.succeed({ projectId: botId, deletedAt: null, activeRunId: null } as never),
        getThreadRecords: (_threadId, fields) =>
          Effect.succeed(
            ((fields as ReadonlyArray<string>).includes("turnItems")
              ? {
                  messages: [
                    {
                      runId,
                      role: "assistant",
                      text: "Booked for 3pm Tuesday.",
                      createdAt: DateTime.makeUnsafe(0),
                      updatedAt: DateTime.makeUnsafe(0),
                    },
                  ],
                  turnItems: [],
                }
              : {
                  messages: [{ role: "user", createdBy: "user", text: "Find me a dentist" }],
                }) as never,
          ),
        sendToThread: (input) =>
          Queue.offer(messages, input).pipe(
            Effect.as({ delivery: "started", run: run("running") } as never),
          ),
        waitForThread: () =>
          Deferred.await(runSettled).pipe(
            Effect.map((settled) => ({ threadId, run: settled, timedOut: false })),
          ),
      }),
    ),
    Layer.provide(ServerSettings.layerTest({ voiceCalls: { openaiApiKey } })),
    Layer.provide(Layer.mock(SecretResolver.SecretResolver)({})),
    // The server's own OPENAI_API_KEY is the fallback; tests must not pick up the machine's.
    Layer.provide(ConfigProvider.layer(ConfigProvider.fromEnvRecord({}))),
  );
  return { layer, sent, socket, messages, runSettled, sessions, run };
});

/** Takes what the server sent OpenAI until one event of `type` arrives. */
const nextSent = (sent: Queue.Queue<Record<string, unknown>>, type: string) =>
  Effect.gen(function* () {
    while (true) {
      const event = yield* Queue.take(sent);
      if (event.type === type) return event;
    }
  });

it.effect(
  "a call hands what the voice delegates to the conversation, speaks results, and leaves a recap",
  () =>
    Effect.gen(function* () {
      const { layer, sent, socket, messages, runSettled, sessions, run } =
        yield* harness("sk-test");
      yield* Effect.gen(function* () {
        const calls = yield* BotCalls.BotCalls;
        const started = yield* calls.start({ projectId: botId, threadId, sdpOffer: "offer" });
        assert.deepStrictEqual(started, { callId: "live_1", sdpAnswer: "answer-for:offer" });
        const session = sessions[0]!;
        assert.strictEqual(session.model, "gpt-live-1");
        assert.include(String(session.instructions), "Wren: dry humour");
        assert.include(JSON.stringify(session.input), "Find me a dentist");

        const openai = yield* Deferred.await(socket);
        assert.include(openai.url, "/v1/live/sessions/live_1/attach");
        openai.emit({ type: "session.started" });
        const greeting = yield* nextSent(sent, "session.commentary.append");
        assert.strictEqual(greeting.delegation_id, null);

        openai.emit({
          type: "session.output_transcript.delta",
          delta: "Hey!",
          start_ms: 0,
          end_ms: 400,
        });
        openai.emit({
          type: "session.input_transcript.delta",
          delta: "Book the dentist for Tuesday",
          start_ms: 600,
          end_ms: 1500,
        });
        openai.emit({
          type: "session.delegation.created",
          offset_ms: 1400,
          delegation: { id: "del_1", type: "delegation", target: "client" },
        });
        openai.emit({
          type: "session.output_transcript.delta",
          delta: "On it.",
          start_ms: 1600,
          end_ms: 2300,
        });
        const request = yield* Queue.take(messages);
        assert.deepStrictEqual(
          {
            text: request.text,
            call: request.call,
            createdBy: request.createdBy,
            mode: request.mode,
          },
          {
            text: "Book the dentist for Tuesday\n\nJust before, on the call:\nWren: Hey!",
            call: { callId: "live_1", kind: "request" },
            createdBy: "user",
            mode: "auto",
          },
        );
        const progress = yield* nextSent(sent, "session.thinking.append");
        assert.strictEqual(progress.delegation_id, "del_1");

        yield* Deferred.succeed(runSettled, run("completed"));
        const result = yield* nextSent(sent, "session.commentary.append");
        assert.strictEqual(result.delegation_id, "del_1");
        assert.include(String(result.content), "Booked for 3pm Tuesday.");

        yield* calls.end({ callId: "live_1" });
        yield* nextSent(sent, "session.close");
        const recap = yield* Queue.take(messages);
        assert.strictEqual(
          recap.text,
          "Wren: Hey!\nUser: Book the dentist for Tuesday\nWren: On it.",
        );
        assert.strictEqual(recap.call?.kind, "recap");
        assert.strictEqual(recap.mode, "queue");
      }).pipe(Effect.provide(layer));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("refuses a call without an OpenAI API key", () =>
  Effect.gen(function* () {
    const { layer } = yield* harness("");
    const error = yield* Effect.flip(
      BotCalls.BotCalls.use((calls) =>
        calls.start({ projectId: botId, threadId, sdpOffer: "offer" }),
      ).pipe(Effect.provide(layer)),
    );
    assert.strictEqual(error._tag === "BotCallError" && error.reason, "not-configured");
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

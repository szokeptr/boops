import {
  type BotCallEndInput,
  type BotCallLanguage,
  defaultBotCallVoice,
  BotCallError,
  type BotCallStartInput,
  type BotCallStartResult,
  CommandId,
  MessageId,
  type ProjectId,
  type RunId,
  type ThreadId,
  isSecretReference,
} from "@t3tools/contracts";
import { subagentResultForRun } from "@t3tools/provider-core/server/subagentProjection";
import * as SecretResolver from "@t3tools/secret-provider-core/server/SecretResolver";
import * as Clock from "effect/Clock";
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FiberMap from "effect/FiberMap";
import * as FiberSet from "effect/FiberSet";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientRequest } from "effect/http";
import * as Socket from "effect/socket/Socket";

import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as ProjectService from "../project/ProjectService.ts";
import { requireSettingsSecret } from "../secrets/settingsSecretValue.ts";
import * as ServerSettings from "../serverSettings.ts";
import { PERSONA_FILE } from "./BotPersona.ts";
import {
  type CallEffect,
  type CallState,
  type RecentMessage,
  appendEvent,
  callInstructions,
  callSessionConfig,
  initialCallState,
  onServerEvent,
  recapText,
  releaseDelegation,
  requestMessage,
  spokenResult,
} from "./botCallLive.ts";

const OPENAI_LIVE_SESSIONS = "https://api.openai.com/v1/live/sessions";
// Only frees a call whose end never arrived; OpenAI expires sessions well before this.
const MAX_CALL = "65 minutes";
const RECENT_MESSAGES = 16;
const RECENT_MESSAGE_CHARS = 700;
const PERSONA_CHARS = 8_000;
const MEMORY_INDEX_CHARS = 4_000;
const RECAP_CHARS = 30_000;
// How long a delegation waits for the user's words to reach the transcript.
const TRANSCRIPT_GRACE = "1500 millis";
// How long hanging up waits for OpenAI to confirm the session closed.
const CLOSE_GRACE = "5 seconds";

export class BotCalls extends Context.Service<
  BotCalls,
  {
    /**
     * Opens a voice call with a bot: sends the client's WebRTC offer to OpenAI's Live API with
     * the bot's voice, persona and recent conversation, and returns OpenAI's answer. The server
     * then follows the call over OpenAI's sideband socket, handing what the voice delegates to
     * the conversation. A new call to the same bot ends the one before it.
     */
    readonly start: (input: BotCallStartInput) => Effect.Effect<BotCallStartResult, BotCallError>;
    /** Hangs up. The conversation gets the call's transcript. */
    readonly end: (input: BotCallEndInput) => Effect.Effect<void>;
    /** Hangs up the call this conversation is on, for the bot itself; false when none is live. */
    readonly endForThread: (threadId: ThreadId) => Effect.Effect<boolean>;
  }
>()("boops/bots/BotCalls") {}

const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

const callError = (reason: BotCallError["reason"], message: string) =>
  new BotCallError({ reason, message });

const clip = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;

const PROGRESS: Record<ThreadManagementService.ThreadManagementSendResult["delivery"], string> = {
  started: "Your conversation got the request and is working on it.",
  queued: "Your conversation got the request and will start on it after its current task.",
  steered: "Your conversation got the request and folded it into the task it is working on.",
  restarted: "Your conversation got the request and restarted its work with it.",
};

const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const http = yield* HttpClient.HttpClient;
  const projects = yield* ProjectService.ProjectService;
  const threads = yield* ThreadManagementService.ThreadManagementService;
  const settings = yield* ServerSettings.ServerSettingsService;
  const secrets = yield* SecretResolver.SecretResolver;
  const makeWebSocket = yield* Socket.WebSocketConstructor;
  const sessions = yield* FiberMap.make<string>();
  const ownerOfCall = new Map<
    string,
    { readonly projectId: ProjectId; readonly threadId: ThreadId }
  >();

  const apiKey = Effect.gen(function* () {
    const configured = (yield* settings.getSettings).voiceCalls.openaiApiKey;
    const key =
      isSecretReference(configured) || configured !== ""
        ? yield* requireSettingsSecret(secrets, configured)
        : Option.getOrElse(yield* Config.String("OPENAI_API_KEY").pipe(Config.option), () => "");
    if (key.trim() === "") {
      return yield* callError(
        "not-configured",
        "Add an OpenAI API key in Settings to call your bots.",
      );
    }
    return key.trim();
  }).pipe(
    Effect.catchTags({
      SettingsSecretUnresolvedError: (error) =>
        Effect.fail(callError("not-configured", error.message)),
      ConfigError: () => Effect.fail(callError("not-configured", "Could not read the API key.")),
      ServerSettingsError: () =>
        Effect.fail(callError("unavailable", "Could not read the settings.")),
    }),
  );

  const readText = (file: string, max: number) =>
    fileSystem.readFileString(file).pipe(
      Effect.map((text) => (text.trim() === "" ? null : clip(text.trim(), max))),
      Effect.orElseSucceed(() => null),
    );

  // Asks OpenAI to close each call's session; the call's fiber ends once it has.
  const closers = new Map<string, Effect.Effect<void>>();

  const end: BotCalls["Service"]["end"] = Effect.fn("BotCalls.end")(function* (input) {
    ownerOfCall.delete(input.callId);
    const close = closers.get(input.callId);
    const fiber = yield* FiberMap.get(sessions, input.callId);
    if (close !== undefined && Option.isSome(fiber)) {
      yield* close;
      yield* Fiber.await(fiber.value).pipe(Effect.timeout(CLOSE_GRACE), Effect.ignore);
    }
    yield* FiberMap.remove(sessions, input.callId);
  });

  const endForThread: BotCalls["Service"]["endForThread"] = Effect.fn("BotCalls.endForThread")(
    function* (threadId) {
      const calls = [...ownerOfCall].filter(([, owner]) => owner.threadId === threadId);
      for (const [callId] of calls) yield* end({ callId });
      return calls.length > 0;
    },
  );

  const start: BotCalls["Service"]["start"] = Effect.fn("BotCalls.start")(function* (input) {
    const key = yield* apiKey;
    const bot = Option.getOrUndefined(
      yield* projects
        .getById(input.projectId)
        .pipe(Effect.mapError(() => callError("unavailable", "Could not read the bot."))),
    );
    if (bot === undefined || bot.mainThreadId == null) {
      return yield* callError("not-found", "That bot no longer exists.");
    }
    const thread = yield* threads
      .getThreadShell(input.threadId)
      .pipe(Effect.mapError(() => callError("unavailable", "Could not read the conversation.")));
    if (thread === null || thread.deletedAt !== null || thread.projectId !== bot.id) {
      return yield* callError("not-found", `That conversation is not ${bot.title}'s.`);
    }

    const recent = yield* threads
      .getThreadRecords(input.threadId, ["messages"], { messageRoles: ["user", "assistant"] })
      .pipe(
        Effect.map((records) =>
          records.messages
            .filter((message) => message.text.trim() !== "")
            .slice(-RECENT_MESSAGES)
            .map((message): RecentMessage => ({
              role:
                message.role === "assistant"
                  ? "assistant"
                  : message.createdBy === "user"
                    ? "user"
                    : "note",
              text: clip(message.text.trim(), RECENT_MESSAGE_CHARS),
            })),
        ),
        Effect.orElseSucceed(() => []),
      );
    const [persona, memoryIndex] = yield* Effect.all([
      readText(path.join(bot.workspaceRoot, PERSONA_FILE), PERSONA_CHARS),
      readText(path.join(bot.workspaceRoot, "memory", "INDEX.md"), MEMORY_INDEX_CHARS),
    ]);
    const language = bot.callSettings?.language ?? null;
    const session = callSessionConfig({
      instructions: callInstructions({
        name: bot.title,
        persona,
        memoryIndex,
        working: thread.activeRunId !== null,
        language,
      }),
      voice: bot.callSettings?.voice ?? defaultBotCallVoice(bot.id),
      language,
      recent,
    });

    const response = yield* http
      .execute(
        HttpClientRequest.post(OPENAI_LIVE_SESSIONS).pipe(
          HttpClientRequest.setHeader("Authorization", `Bearer ${key}`),
          HttpClientRequest.bodyJsonUnsafe({
            session,
            transport: { type: "webrtc", sdp: input.sdpOffer },
          }),
        ),
      )
      .pipe(
        Effect.timeout("20 seconds"),
        Effect.mapError(() => callError("unavailable", "Could not reach OpenAI.")),
      );
    const body = parseEvent(yield* response.text.pipe(Effect.orElseSucceed(() => "")));
    if (response.status < 200 || response.status >= 300) {
      return yield* callError(
        "rejected",
        openAiErrorMessage(body) ?? `OpenAI refused the call (HTTP ${response.status}).`,
      );
    }
    const created = body as {
      readonly session?: { readonly id?: unknown };
      readonly transport?: { readonly sdp?: unknown };
    } | null;
    const callId = created?.session?.id;
    const sdpAnswer = created?.transport?.sdp;
    if (typeof callId !== "string" || callId === "" || typeof sdpAnswer !== "string") {
      return yield* callError("rejected", "OpenAI did not return a call.");
    }

    for (const [otherCall, owner] of ownerOfCall) {
      if (owner.projectId === bot.id) yield* end({ callId: otherCall });
    }
    ownerOfCall.set(callId, { projectId: bot.id, threadId: input.threadId });
    yield* FiberMap.run(
      sessions,
      callId,
      followCall({
        callId,
        key,
        projectId: bot.id,
        threadId: input.threadId,
        botName: bot.title,
        language,
        activeRunId: thread.activeRunId,
      }).pipe(
        Effect.timeout(MAX_CALL),
        Effect.catchCause((cause) =>
          Effect.logWarning("Voice call ended with an error", { cause }),
        ),
        Effect.ensuring(
          Effect.sync(() => {
            ownerOfCall.delete(callId);
            closers.delete(callId);
          }),
        ),
      ),
    );
    return { callId, sdpAnswer };
  });

  const followCall = Effect.fn("BotCalls.followCall")(function* (call: {
    readonly callId: string;
    readonly key: string;
    readonly projectId: ProjectId;
    readonly threadId: ThreadId;
    readonly botName: string;
    readonly language: BotCallLanguage | null;
    readonly activeRunId: RunId | null;
  }) {
    const startedAt = yield* Clock.currentTimeMillis;
    const state = yield* Ref.make(initialCallState(call.language));
    // Requests and run watchers end with the call.
    const tasks = yield* FiberSet.make();
    const socket = yield* Socket.makeWebSocket(
      `${OPENAI_LIVE_SESSIONS.replace(/^https:/, "wss:")}/${encodeURIComponent(call.callId)}/attach`,
      { openTimeout: "10 seconds", headers: { Authorization: `Bearer ${call.key}` } },
    ).pipe(Effect.provideService(Socket.WebSocketConstructor, makeWebSocket));
    const writer = yield* socket.writer;
    const send = (event: Readonly<Record<string, unknown>>) =>
      writer.write(encodeJson(event)).pipe(Effect.ignore);
    closers.set(call.callId, send({ type: "session.close", event_id: "hang-up" }));
    const watchedRuns = new Set<RunId>();
    // The delegation a run's result answers: the latest one the run took on.
    const delegationOfRun = new Map<RunId, string>();
    let appends = 0;
    const append = (
      kind: "commentary" | "thinking",
      delegationId: string | null,
      content: string,
    ) => send(appendEvent(kind, delegationId, content, `${kind}-${++appends}`));

    const apply = (step: (current: CallState) => readonly [ReadonlyArray<CallEffect>, CallState]) =>
      Ref.modify(state, step).pipe(Effect.flatMap(runEffects));

    const runEffects = (effects: ReadonlyArray<CallEffect>): Effect.Effect<void> =>
      Effect.forEach(
        effects,
        (effect) => {
          switch (effect.type) {
            case "send":
              return send(effect.event);
            case "delegate":
              return FiberSet.run(
                tasks,
                delegate(effect.delegationId, effect.request, effect.context),
              ).pipe(Effect.asVoid);
            case "await-transcript":
              return FiberSet.run(
                tasks,
                Effect.sleep(TRANSCRIPT_GRACE).pipe(
                  Effect.andThen(
                    apply((current) => {
                      const step = releaseDelegation(current, effect.delegationId);
                      return [step.effects, step.state];
                    }),
                  ),
                ),
              ).pipe(Effect.asVoid);
          }
        },
        { discard: true },
      );

    // Tells the call when a run settles, delegated helpers included. Each run is watched once.
    const watchRun = (runId: RunId): Effect.Effect<void> => {
      if (watchedRuns.has(runId)) return Effect.void;
      watchedRuns.add(runId);
      return Effect.gen(function* () {
        const waited = yield* threads.waitForThread({
          projectId: call.projectId,
          threadId: call.threadId,
          runId,
          timeoutMs: 60 * 60_000,
          untilDelegatedWorkSettled: true,
        });
        const run = waited.resultRun ?? waited.run;
        if (waited.timedOut || run === null) return;
        const records = yield* threads.getThreadRecords(call.threadId, ["messages", "turnItems"], {
          messageRoles: ["assistant"],
          messageRunIds: [run.id],
          turnItemRunIds: [run.id],
          turnItemTypes: ["assistant_message", "error"],
        });
        const result = subagentResultForRun(records, run);
        yield* append(
          "commentary",
          delegationOfRun.get(runId) ?? null,
          spokenResult(
            run.status === "completed"
              ? `Your conversation finished: ${result.text}`
              : run.status === "failed"
                ? `Your conversation's work failed: ${result.text}`
                : `Your conversation stopped (${run.status}) before finishing.`,
          ),
        );
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("Could not follow a call's request", { cause }),
        ),
        (effect) => FiberSet.run(tasks, effect),
        Effect.asVoid,
      );
    };

    const delegate = Effect.fn("BotCalls.delegate")(
      function* (
        delegationId: string,
        request: string,
        context: Parameters<typeof requestMessage>[1],
      ) {
        if (request === "") {
          return yield* append(
            "commentary",
            delegationId,
            "Nothing reached your conversation: you did not catch the request. Ask the user to say it again.",
          );
        }
        const sent = yield* threads.sendToThread({
          projectId: call.projectId,
          threadId: call.threadId,
          commandId: CommandId.make(`bot-call:${call.callId}:${delegationId}`),
          messageId: MessageId.make(`bot-call:${call.callId}:${delegationId}`),
          text: requestMessage(request, context, call.botName),
          call: { callId: call.callId, kind: "request" },
          attachments: [],
          mode: "auto",
          createdBy: "user",
          creationSource: "server",
        });
        delegationOfRun.set(sent.run.id, delegationId);
        yield* append("thinking", delegationId, PROGRESS[sent.delivery]);
        yield* watchRun(sent.run.id);
      },
      (effect, delegationId) =>
        effect.pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("A call's request did not reach the conversation", { cause }).pipe(
              Effect.andThen(
                append(
                  "commentary",
                  delegationId,
                  "That request did not reach your conversation. Say so, and offer to try again.",
                ),
              ),
            ),
          ),
        ),
    );

    const recap = Effect.gen(function* () {
      const { fragments } = yield* Ref.get(state);
      if (!fragments.some((fragment) => fragment.speaker === "user")) return;
      const text = recapText(fragments, call.botName);
      yield* threads.sendToThread({
        projectId: call.projectId,
        threadId: call.threadId,
        commandId: CommandId.make(`bot-call-recap:${call.callId}`),
        messageId: MessageId.make(`bot-call-recap:${call.callId}`),
        text: text.length > RECAP_CHARS ? `…${text.slice(-RECAP_CHARS)}` : text,
        call: {
          callId: call.callId,
          kind: "recap",
          durationSeconds: Math.round(((yield* Clock.currentTimeMillis) - startedAt) / 1000),
        },
        attachments: [],
        mode: "queue",
        createdBy: "system",
        creationSource: "server",
      });
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("Could not save the call's transcript", { cause }),
      ),
    );

    if (call.activeRunId !== null) yield* watchRun(call.activeRunId);
    const decoder = new TextDecoder();
    const reader = yield* socket.reader;
    yield* Effect.gen(function* () {
      while (true) {
        for (const frame of yield* reader.pull) {
          const event = parseEvent(typeof frame === "string" ? frame : decoder.decode(frame));
          if (event === null) continue;
          if (event.type === "session.closed") return;
          if (event.type === "error") {
            yield* Effect.logWarning("OpenAI reported a call error", { error: event.error });
            continue;
          }
          yield* apply((current) => {
            const step = onServerEvent(current, event);
            return [step.effects, step.state];
          });
        }
      }
    }).pipe(
      // OpenAI may close the socket without a final event; that ends the call too.
      Effect.catchTags({ SocketError: () => Effect.void }),
      Effect.ensuring(recap),
    );
  }, Effect.scoped);

  return BotCalls.of({ start, end, endForThread });
});

function parseEvent(raw: string): Readonly<Record<string, unknown>> | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function openAiErrorMessage(body: Readonly<Record<string, unknown>> | null): string | null {
  const error = body?.error as { readonly message?: unknown } | undefined;
  return typeof error?.message === "string" && error.message.trim() !== ""
    ? error.message.trim()
    : null;
}

export const layer = Layer.effect(BotCalls, make);

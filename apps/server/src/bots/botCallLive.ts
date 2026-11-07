/**
 * A bot's voice call, decided without I/O: the GPT-Live session it opens with, and what each
 * event from OpenAI's sideband socket makes the call do next. The Live model hands work to the
 * bot's conversation through client delegations; delegations carry no text, so the request is
 * rebuilt from the call's transcript.
 */

import type { BotCallLanguage } from "@t3tools/contracts";

const LIVE_MODEL = "gpt-live-1";

export interface CallContext {
  readonly name: string;
  readonly persona: string | null;
  readonly memoryIndex: string | null;
  /** A turn was already running when the call began. */
  readonly working: boolean;
  /** Null: speak whatever language the user speaks. */
  readonly language: BotCallLanguage | null;
}

export interface RecentMessage {
  readonly role: "user" | "assistant" | "note";
  readonly text: string;
}

const greeting = (language: BotCallLanguage | null) =>
  `The call just connected. Pick up like answering a call from a friend: one short greeting in character${language === null ? "" : `, in ${language}`}, then listen.`;

export function callInstructions(context: CallContext): string {
  const sections = [
    `You are ${context.name}, on a live voice call with the person you work for. They know you from your chat in Boops; this call is that same conversation, and you are its voice.
Talk like a phone call: warm, natural, one to three short sentences at a time. No lists, markdown or URLs read aloud. ${context.language === null ? "Speak the user's language." : `Always speak ${context.language}, even when the user speaks another language, unless they ask you to switch.`}
Backchannel policy: Use light backchannels. Acknowledge naturally without competing with the user.
Interruption policy: Stop speaking when the user interrupts. Listen to what they say.
Delegation policy:
Backend tools:
- Your conversation: it hears the user's own words and has your tools, files, notes, the web and the time to think. It can research, write, change things, and stop or redirect work it is doing.
Generate <|SpawnThinking|> when:
- The user wants anything done, looked up, checked, remembered or thought through.
- The user asks how ongoing work is going, or wants it stopped or changed.
- A correction changes work already requested.
- The user says goodbye or wants to end the call: your conversation hangs up.
Do not generate <|SpawnThinking|> when:
- You can answer from this call or a result you already have.
- The user is greeting you or chatting.
- You need a brief clarification to understand the request.
Generate <|SpawnThinking|> before giving an answer that depends on your conversation's work.
Do not guess the result while waiting. Never pretend you did something yourself, and never make up results or facts about the user.
Your conversation's results arrive as commentary. Tell the user what matters in a sentence or two and offer the rest; the full answer is in the chat too, so never read out long text.
You cannot hang up yourself; your conversation does. When the user says goodbye or wants to end the call, say one short goodbye and generate <|SpawnThinking|>. The call ends a few seconds later.`,
  ];
  if (context.persona !== null) sections.push(`Who you are (your PERSONA.md):\n${context.persona}`);
  if (context.memoryIndex !== null) {
    sections.push(`Your notes (memory/INDEX.md):\n${context.memoryIndex}`);
  }
  if (context.working) {
    sections.push(
      "Your conversation is in the middle of a task right now; its result will arrive as commentary.",
    );
  }
  return sections.join("\n\n");
}

// What the client's data channel may receive: captions, and the end of the session.
const CLIENT_SERVER_EVENTS = [
  "session.input_transcript.delta",
  "session.output_transcript.delta",
  "session.closed",
] as const;

/** The `session` part of the create request. */
export function callSessionConfig(input: {
  readonly instructions: string;
  readonly voice: string;
  readonly language: BotCallLanguage | null;
  /** The conversation's latest messages, oldest first. */
  readonly recent: ReadonlyArray<RecentMessage>;
}) {
  return {
    model: LIVE_MODEL,
    instructions: input.instructions,
    audio: { output: { voice: input.voice } },
    delegation: { type: "client" },
    input: [
      ...input.recent.map((message) =>
        message.role === "assistant"
          ? {
              type: "message",
              role: "assistant",
              content: [{ type: "output_text", text: message.text }],
            }
          : {
              type: "message",
              role: message.role === "user" ? "user" : "developer",
              content: [
                {
                  type: "input_text",
                  text: message.role === "user" ? message.text : `Note: ${message.text}`,
                },
              ],
            },
      ),
      {
        type: "message",
        role: "developer",
        content: [{ type: "input_text", text: greeting(input.language) }],
      },
    ],
    // The client only plays audio and shows captions; the server steers the call.
    client: {
      data_channel: {
        allowed_client_events: [],
        allowed_server_events: CLIENT_SERVER_EVENTS.map((type) => ({ type })),
      },
    },
  };
}

export interface Fragment {
  readonly speaker: "user" | "bot";
  readonly text: string;
  /** Where the fragment starts on the session's timeline. */
  readonly startMs: number;
}

export interface TranscriptLine {
  readonly speaker: "user" | "bot";
  readonly text: string;
}

export interface CallState {
  /** Both sides' transcript fragments, as they arrived. */
  readonly fragments: ReadonlyArray<Fragment>;
  /** How far along the timeline the transcript reaches. */
  readonly heardUntilMs: number;
  /** Where the user's latest words end. */
  readonly userUntilMs: number;
  /** The user's words before this point already went to a delegation. */
  readonly delegatedUntilMs: number;
  /** Delegations waiting for the user to finish what they were saying. */
  readonly waiting: ReadonlyArray<{ readonly id: string; readonly offsetMs: number }>;
  /** What the model is told to say when the session starts; null once greeted. */
  readonly greeting: string | null;
}

export const initialCallState = (language: BotCallLanguage | null): CallState => ({
  fragments: [],
  heardUntilMs: 0,
  userUntilMs: 0,
  delegatedUntilMs: 0,
  waiting: [],
  greeting: greeting(language),
});

export type CallEffect =
  | { readonly type: "send"; readonly event: Readonly<Record<string, unknown>> }
  /** Hand the user's request to the conversation, answering on this delegation. */
  | {
      readonly type: "delegate";
      readonly delegationId: string;
      readonly request: string;
      /** The lines said just before the request. */
      readonly context: ReadonlyArray<TranscriptLine>;
    }
  /** Release this delegation even if its words never show up in the transcript. */
  | { readonly type: "await-transcript"; readonly delegationId: string };

interface Step {
  readonly state: CallState;
  readonly effects: ReadonlyArray<CallEffect>;
}

export function appendEvent(
  kind: "commentary" | "thinking" | "instructions",
  delegationId: string | null,
  content: string,
  eventId: string,
) {
  return {
    type: `session.${kind}.append`,
    event_id: eventId,
    delegation_id: delegationId,
    content,
  };
}

const CONTEXT_LINES = 4;
const CONTEXT_LINE_CHARS = 240;

const clip = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;

// Separate utterances arrive without a space between them.
const spoken = (fragments: ReadonlyArray<Fragment>) =>
  fragments
    .map((fragment) => fragment.text)
    .join("")
    .replace(/([.!?])(?=\p{Lu})/gu, "$1 ")
    .replace(/\s+/g, " ")
    // A transcript split mid-sentence can leave the next part starting with its punctuation.
    .replace(/^[\s.,;:!?]+/, "")
    .trim();

function transcriptLines(fragments: ReadonlyArray<Fragment>): Array<TranscriptLine> {
  const runs: Array<{ speaker: "user" | "bot"; fragments: Fragment[] }> = [];
  for (const fragment of fragments) {
    const last = runs.at(-1);
    if (last?.speaker === fragment.speaker) last.fragments.push(fragment);
    else runs.push({ speaker: fragment.speaker, fragments: [fragment] });
  }
  return runs
    .map((run) => ({ speaker: run.speaker, text: spoken(run.fragments) }))
    .filter((line) => line.text !== "");
}

// The model often delegates mid-sentence, so a delegation waits until the user pauses.
const USER_PAUSE_MS = 700;

// Hands each waiting delegation the user's words since the previous one, once the transcript
// shows the user paused after it (or right away, up to `force`).
function release(state: CallState, force: string | null): Step {
  const forceIndex = force === null ? -1 : state.waiting.findIndex((item) => item.id === force);
  const effects: CallEffect[] = [];
  let delegatedUntilMs = state.delegatedUntilMs;
  let released = 0;
  for (const [index, item] of state.waiting.entries()) {
    const paused =
      state.heardUntilMs >= item.offsetMs &&
      state.heardUntilMs >= state.userUntilMs + USER_PAUSE_MS;
    if (index > forceIndex && !paused) break;
    const words = state.fragments.filter(
      (fragment) => fragment.speaker === "user" && fragment.startMs >= delegatedUntilMs,
    );
    const first = words[0];
    const before =
      first === undefined
        ? state.fragments
        : state.fragments.slice(0, state.fragments.indexOf(first));
    effects.push({
      type: "delegate",
      delegationId: item.id,
      request: spoken(words),
      context: transcriptLines(before)
        .slice(-CONTEXT_LINES)
        .map((line) => ({ ...line, text: clip(line.text, CONTEXT_LINE_CHARS) })),
    });
    const last = words.at(-1);
    if (last !== undefined) delegatedUntilMs = Math.max(delegatedUntilMs, last.startMs + 1);
    released += 1;
  }
  return released === 0
    ? { state, effects }
    : { state: { ...state, waiting: state.waiting.slice(released), delegatedUntilMs }, effects };
}

type ServerEvent = Readonly<Record<string, unknown>> & { readonly type?: unknown };

const number = (value: unknown, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

/** What one sideband server event changes, and what the call does about it. */
export function onServerEvent(state: CallState, event: ServerEvent): Step {
  switch (event.type) {
    case "session.started":
      return state.greeting === null
        ? { state, effects: [] }
        : {
            state: { ...state, greeting: null },
            effects: [
              { type: "send", event: appendEvent("commentary", null, state.greeting, "greeting") },
            ],
          };
    case "session.input_transcript.delta":
    case "session.output_transcript.delta": {
      if (typeof event.delta !== "string" || event.delta === "") return { state, effects: [] };
      const startMs = number(event.start_ms, state.heardUntilMs);
      const endMs = number(event.end_ms, startMs);
      const user = event.type === "session.input_transcript.delta";
      const next: CallState = {
        ...state,
        // Hearing the user means the call is underway; a greeting now would talk over them.
        greeting: null,
        fragments: [
          ...state.fragments,
          { speaker: user ? "user" : "bot", text: event.delta, startMs },
        ],
        heardUntilMs: Math.max(state.heardUntilMs, endMs),
        userUntilMs: user ? Math.max(state.userUntilMs, endMs) : state.userUntilMs,
      };
      return release(next, null);
    }
    case "session.delegation.created": {
      const delegation = event.delegation as
        | { readonly id?: unknown; readonly target?: unknown }
        | undefined;
      if (typeof delegation?.id !== "string" || delegation.target !== "client") {
        return { state, effects: [] };
      }
      const waiting: CallState = {
        ...state,
        waiting: [
          ...state.waiting,
          { id: delegation.id, offsetMs: number(event.offset_ms, state.heardUntilMs) },
        ],
      };
      const step = release(waiting, null);
      return step.state.waiting.some((item) => item.id === delegation.id)
        ? {
            state: step.state,
            effects: [...step.effects, { type: "await-transcript", delegationId: delegation.id }],
          }
        : step;
    }
    default:
      return { state, effects: [] };
  }
}

/** Releases a delegation whose transcript is late, with whatever was heard by now. */
export function releaseDelegation(state: CallState, delegationId: string): Step {
  return state.waiting.some((item) => item.id === delegationId)
    ? release(state, delegationId)
    : { state, effects: [] };
}

/** The message the bot's conversation receives for a request made on the call. */
export function requestMessage(
  request: string,
  context: ReadonlyArray<TranscriptLine>,
  botName: string,
): string {
  if (context.length === 0) return request;
  const earlier = context
    .map((line) => `${line.speaker === "user" ? "User" : botName}: ${line.text}`)
    .join("\n");
  return `${request}\n\nJust before, on the call:\n${earlier}`;
}

// A commentary append holds at most 500 tokens.
const RESULT_CHARS = 1_500;

/** A finished request's result, short enough to append for the model to speak. */
export function spokenResult(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > RESULT_CHARS
    ? `${trimmed.slice(0, RESULT_CHARS).trimEnd()}… (The rest is in the chat.)`
    : trimmed;
}

/** The call's transcript as the bot's conversation receives it once the call ends. */
export function recapText(fragments: ReadonlyArray<Fragment>, botName: string): string {
  return transcriptLines(fragments)
    .map((line) => `${line.speaker === "user" ? "User" : botName}: ${line.text}`)
    .join("\n");
}

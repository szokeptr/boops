import { expect, it } from "vite-plus/test";

import { botCallRequestWords, foldBotCallMessages } from "./callFolding.ts";

const user = (id: string, runId: string, call?: { kind: "request" | "recap"; callId: string }) => ({
  id,
  role: "user",
  runId,
  context:
    call === undefined
      ? undefined
      : call.kind === "request"
        ? { call: { callId: call.callId, kind: "request" as const } }
        : { call: { callId: call.callId, kind: "recap" as const, durationSeconds: 60 } },
});
const bot = (id: string, runId: string) => ({ id, role: "assistant", runId });

it("folds a call's requests and the bot's replies into its transcript row, but not the reply after the call", () => {
  const messages = [
    user("typed", "run-0"),
    bot("typed-reply", "run-0"),
    user("ask-mail", "run-1", { kind: "request", callId: "live_1" }),
    bot("mail-reply", "run-1"),
    user("ask-card", "run-2", { kind: "request", callId: "live_1" }),
    bot("card-reply-1", "run-2"),
    bot("card-reply-2", "run-2"),
    user("recap", "run-3", { kind: "recap", callId: "live_1" }),
    bot("after-call", "run-3"),
    user("ask-live", "run-4", { kind: "request", callId: "live_2" }),
  ];
  const { hidden, workByRecapId } = foldBotCallMessages(messages);
  expect([...hidden]).toEqual([
    "ask-mail",
    "mail-reply",
    "ask-card",
    "card-reply-1",
    "card-reply-2",
    "ask-live",
  ]);
  expect(
    workByRecapId
      .get("recap")
      ?.map((entry) => [entry.request.id, entry.replies.map((reply) => reply.id)]),
  ).toEqual([
    ["ask-mail", ["mail-reply"]],
    ["ask-card", ["card-reply-1", "card-reply-2"]],
  ]);
  // A call still going has no transcript yet; its requests stay out of the conversation.
  expect(workByRecapId.size).toBe(1);
});

it("shows a request without the call context the bot gets with it", () => {
  expect(botCallRequestWords("Check my mail\n\nJust before, on the call:\nJarvis: Hi")).toBe(
    "Check my mail",
  );
  expect(botCallRequestWords("Check my mail")).toBe("Check my mail");
});

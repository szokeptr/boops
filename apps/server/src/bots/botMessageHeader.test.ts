import { describe, expect, it } from "@effect/vitest";
import { ProjectId, ThreadId } from "@t3tools/contracts";
import { POCKS_BOT_INSTRUCTIONS } from "@t3tools/provider-core/server/orchestrationInstructions";

import { isHelperTask, withBotMessageHeader, withHelperTaskHeader } from "./botMessageHeader.ts";

const context = (relation: "parent" | "child" | "peer" | "background", name = "Wren") => ({
  version: 1 as const,
  records: [],
  bot: { projectId: ProjectId.make("wren"), name, relation },
});

describe("withBotMessageHeader", () => {
  it("names the sender and the tool that answers it", () => {
    expect(withBotMessageHeader("How was the run?", context("parent"))).toBe(
      "[From Wren, your parent bot. Answer with report_to_parent.]\n\nHow was the run?",
    );
    expect(withBotMessageHeader("Dana ran 14 km.", context("child"))).toBe(
      "[From Wren, a bot you created. Answer with message_child_bot.]\n\nDana ran 14 km.",
    );
    expect(withBotMessageHeader("Rent is paid.", context("peer"))).toBe(
      "[From Wren, another bot. Answer with message_bot, projectId wren.]\n\nRent is paid.",
    );
    expect(
      withBotMessageHeader("The visa form is due Friday.", context("background", "Heartbeat")),
    ).toBe(
      '[From your background thread "Heartbeat". The user has not seen this; tell them what needs them.]\n\nThe visa form is due Friday.',
    );
  });

  it("tells the bot how a voice call's request and recap reach it", () => {
    const call = (kind: "request" | "recap") => ({
      version: 1 as const,
      records: [],
      call: { callId: "rtc_1", kind },
    });
    expect(withBotMessageHeader("Book the dentist.", call("request"))).toMatch(
      /^\[Said on a voice call\.[^\n]*spoken sentences[^\n]*\]\n\nBook the dentist\.$/,
    );
    expect(withBotMessageHeader("User: hi", call("recap"))).toMatch(
      /^\[The user's voice call with you just ended;[^\n]*memory\/[^\n]*\]\n\nUser: hi$/,
    );
  });

  it("leaves other messages alone", () => {
    expect(withBotMessageHeader("hi", undefined)).toBe("hi");
    expect(withBotMessageHeader("hi", { version: 1, records: [] })).toBe("hi");
  });
});

describe("isHelperTask", () => {
  const main = ThreadId.make("wren-main");
  const thread = (relationshipToParent: "subagent" | "fork" | null) => ({
    lineage: { rootThreadId: main, parentThreadId: main, relationshipToParent },
  });

  it("marks only what a delegated child receives from the thread that delegated it", () => {
    expect(isHelperTask(thread("subagent"), main)).toBe(true);
    // The user writing into a helper's thread, or another bot messaging it, is not its brief.
    expect(isHelperTask(thread("subagent"), undefined)).toBe(false);
    expect(isHelperTask(thread("subagent"), ThreadId.make("pace-main"))).toBe(false);
    // A fork, or a bot's main conversation hearing from its parent bot, stays a conversation.
    expect(isHelperTask(thread("fork"), main)).toBe(false);
    expect(isHelperTask(thread(null), main)).toBe(false);
  });

  it("opens the task with the prefix the bot instructions tell a helper to look for", () => {
    expect(withHelperTaskHeader("Compare flights.")).toMatch(
      /^\[Helper task [^\n]*\]\n\nCompare flights\.$/,
    );
    expect(POCKS_BOT_INSTRUCTIONS).toContain("A task starting `[Helper task` makes you");
  });
});

import { describe, expect, it } from "vite-plus/test";

import { ComposerContextId, GuestMessageId, ProjectId, ScheduledTaskId } from "@t3tools/contracts";
import { ATTACHMENT_ONLY_BOOTSTRAP_PROMPT } from "@t3tools/shared/composerContextReferences";

import {
  resolveUserMessageFileCards,
  resolveUserMessageGrouping,
  resolveUserMessagePresentation,
  routineLabelText,
  withoutSilentRoutineWakes,
  foldRepeatedRoutineRuns,
} from "./userMessage.ts";

describe("resolveUserMessageGrouping", () => {
  const own = { role: "user", text: "hello" };

  it("groups only adjacent own messages", () => {
    expect(resolveUserMessageGrouping(own, own, own)).toEqual({
      groupedWithPrevious: true,
      groupedWithNext: true,
      continuesSteer: false,
    });
    expect(resolveUserMessageGrouping(own, undefined, own)).toMatchObject({
      groupedWithPrevious: false,
      groupedWithNext: true,
    });
    for (const boundary of [
      undefined,
      { ...own, role: "assistant" },
      { ...own, createdBy: "agent" as const },
      { ...own, createdBy: "agent" as const, creationSource: "server" as const },
      {
        ...own,
        routine: {
          taskId: ScheduledTaskId.make("task"),
          name: "Task",
          trigger: "interval",
        } as const,
      },
      {
        ...own,
        context: {
          guest: { guestMessageId: GuestMessageId.make("guest"), name: "Sam", text: "hi" },
        },
      },
    ]) {
      expect(resolveUserMessageGrouping(own, boundary, boundary)).toEqual({
        groupedWithPrevious: false,
        groupedWithNext: false,
        continuesSteer: false,
      });
      expect(resolveUserMessageGrouping(boundary, own, own)).toEqual({
        groupedWithPrevious: false,
        groupedWithNext: false,
        continuesSteer: false,
      });
    }
  });

  it("shows one label for consecutive steers, including promoted queued messages", () => {
    for (const inputIntent of ["steer", "promoted_queued_to_steer"] as const) {
      const steer = { ...own, inputIntent };
      expect(
        resolveUserMessageGrouping(steer, { ...own, inputIntent: "steer" }, undefined)
          .continuesSteer,
      ).toBe(true);
      expect(
        resolveUserMessageGrouping(
          steer,
          { ...own, inputIntent: "promoted_queued_to_steer" },
          undefined,
        ).continuesSteer,
      ).toBe(true);
      expect(resolveUserMessageGrouping(steer, own, undefined).continuesSteer).toBe(false);
      expect(resolveUserMessageGrouping(own, steer, undefined).continuesSteer).toBe(false);
    }
  });
});

describe("resolveUserMessageFileCards", () => {
  const file = {
    type: "file" as const,
    id: "report",
    name: "report.pdf",
    mimeType: "application/pdf",
    sizeBytes: 1024,
  };
  const record = {
    ...file,
    version: 1 as const,
    kind: "file" as const,
    contextId: ComposerContextId.make("report"),
    label: file.name,
    attachmentId: file.id,
  };
  const context = { version: 1 as const, records: [record] };
  const reference = "[report.pdf](t3-context://v1/file/report)";

  it("shows file cards for bare attachments and bound file references", () => {
    for (const text of ["", " \n", reference]) {
      expect(resolveUserMessageFileCards({ text, attachments: [file], context })).toEqual([file]);
    }
    expect(
      resolveUserMessageFileCards({
        text: `${reference}\n${reference}`,
        attachments: [file],
        context,
      }),
    ).toEqual([file]);
  });

  it("keeps words and unavailable or non-file references in the bubble", () => {
    for (const text of [
      `read ${reference}`,
      "[missing.pdf](t3-context://v1/file/missing)",
      "[report.pdf](t3-context://v1/mention/report)",
    ]) {
      expect(resolveUserMessageFileCards({ text, attachments: [file], context })).toBeNull();
    }
    expect(resolveUserMessageFileCards({ text: reference, attachments: [file] })).toBeNull();
    expect(
      resolveUserMessageFileCards({
        text: reference,
        attachments: [file],
        context: {
          version: 1,
          records: [
            {
              version: 1,
              kind: "file",
              contextId: record.contextId,
              label: file.name,
              payload: {},
            },
          ],
        },
      }),
    ).toBeNull();
    expect(
      resolveUserMessageFileCards({
        text: reference,
        attachments: [{ ...file, id: "other" }],
        context,
      }),
    ).toBeNull();
  });

  it("keeps media, unknown attachments, and empty messages out of the file cards", () => {
    const media = [
      { ...file, type: "image" as const, name: "photo.png", mimeType: "image/png" },
      { ...file, name: "photo.png", mimeType: "application/octet-stream" },
      { ...file, name: "clip.mp4", mimeType: "video/mp4" },
      { ...file, name: "clip.mov", mimeType: "application/octet-stream" },
      { ...file, name: "voice.mp3", mimeType: "audio/mpeg" },
      { ...file, type: "future" },
    ];
    expect(resolveUserMessageFileCards({ text: "", attachments: [] })).toBeNull();
    for (const attachment of media) {
      expect(resolveUserMessageFileCards({ text: "", attachments: [attachment] })).toBeNull();
      expect(resolveUserMessageFileCards({ text: "", attachments: [file, attachment] })).toBeNull();
    }
  });
});

describe("resolveUserMessagePresentation", () => {
  const legacyText = "[Triggered by schedule task: Daily audit]\n\nCheck for crashes.\n";

  it("preserves user-written and assistant-quoted schedule headers", () => {
    for (const message of [
      { role: "user", createdBy: "user" as const },
      { role: "user" },
      { role: "assistant", createdBy: "agent" as const },
    ]) {
      expect(resolveUserMessagePresentation({ ...message, text: legacyText })).toEqual({
        text: legacyText,
        attribution: null,
        routine: undefined,
      });
    }
  });

  it("hides the prompt that stands in for an attachment-only message", () => {
    for (const text of [
      ATTACHMENT_ONLY_BOOTSTRAP_PROMPT,
      `Ultrathink:\n${ATTACHMENT_ONLY_BOOTSTRAP_PROMPT}`,
    ]) {
      expect(resolveUserMessagePresentation({ role: "user", text })).toEqual({
        text: "",
        attribution: null,
        routine: undefined,
      });
    }
  });

  it("shows a guest's own words and name, not the attributed text the agent reads", () => {
    expect(
      resolveUserMessagePresentation({
        role: "user",
        createdBy: "user",
        text: "Message from guest Sam, sent by the owner:\n\nWhy?",
        context: {
          guest: {
            guestMessageId: GuestMessageId.make("guest-message:one"),
            name: "Sam",
            text: "Why?",
          },
        },
      }),
    ).toEqual({ text: "Why?", attribution: "guest", routine: undefined, guestName: "Sam" });
  });

  it("attributes server-sent messages to T3 Code or the system, not another agent", () => {
    const text = "Note: the T3 server restarted.";
    expect(
      resolveUserMessagePresentation({
        role: "user",
        createdBy: "agent",
        creationSource: "server",
        text,
      }),
    ).toMatchObject({ attribution: "t3code" });
    for (const creationSource of ["mcp", "provider"] as const) {
      expect(
        resolveUserMessagePresentation({ role: "user", createdBy: "agent", creationSource, text }),
      ).toMatchObject({ attribution: "agent" });
    }
    expect(
      resolveUserMessagePresentation({
        role: "user",
        createdBy: "system",
        creationSource: "server",
        text: "You were just created. Start hatching.",
      }),
    ).toMatchObject({ attribution: "system" });
  });

  it("shows a parent or child bot's message as that bot's, without its routing line", () => {
    const fromBot = { role: "user", createdBy: "agent", creationSource: "server" } as const;
    expect(
      resolveUserMessagePresentation({
        ...fromBot,
        text: "Dana ran 14 km.",
        context: {
          bot: { projectId: ProjectId.make("pace"), name: "Pace", relation: "child" },
        },
      }),
    ).toEqual({
      text: "Dana ran 14 km.",
      attribution: "bot",
      routine: undefined,
      bot: { name: "Pace", projectId: "pace", background: false },
    });
    // The bot's own heartbeat thread is labelled by that thread, not by the bot.
    expect(
      resolveUserMessagePresentation({
        ...fromBot,
        text: "The visa form is due Friday.",
        context: {
          bot: { projectId: ProjectId.make("wren"), name: "Heartbeat", relation: "background" },
        },
      }),
    ).toMatchObject({
      text: "The visa form is due Friday.",
      attribution: "bot",
      bot: { name: "From Heartbeat", projectId: "wren", background: true },
    });
    // Older messages carried the routing line in their text.
    for (const routing of [
      "[From Wren, your parent bot. Answer with report_to_parent.]",
      "[From Pace, a bot you created. Answer with message_child_bot.]",
    ]) {
      expect(
        resolveUserMessagePresentation({ ...fromBot, text: `${routing}\n\nHow was the run?` }),
      ).toMatchObject({
        text: "How was the run?",
        attribution: "bot",
        bot: { name: routing.includes("Wren") ? "Wren" : "Pace", projectId: null },
      });
    }
    // The user typing the same words is still the user.
    expect(
      resolveUserMessagePresentation({
        role: "user",
        createdBy: "user",
        text: "[From Wren, your parent bot. Answer with report_to_parent.]\n\nhi",
      }),
    ).toMatchObject({ attribution: null });
  });

  it("keeps a request said on a call as the user's own, and shows the call's transcript as a call", () => {
    expect(
      resolveUserMessagePresentation({
        role: "user",
        createdBy: "user",
        creationSource: "server",
        text: "Book the dentist for Tuesday.",
        context: { call: { callId: "rtc_1", kind: "request" } },
      }),
    ).toMatchObject({ attribution: null, call: { kind: "request" } });
    // Sent by the server once the call ends; without its call it would be a system divider.
    expect(
      resolveUserMessagePresentation({
        role: "user",
        createdBy: "system",
        creationSource: "server",
        text: "You: hi",
        context: { call: { callId: "rtc_1", kind: "recap", durationSeconds: 75 } },
      }),
    ).toMatchObject({ attribution: "call", call: { durationSeconds: 75 } });
  });

  it("labels a routine message with the routine's name and trigger", () => {
    const routine = {
      taskId: ScheduledTaskId.make("task:heartbeat"),
      name: "Heartbeat",
      trigger: "interval",
    } as const;
    const presentation = resolveUserMessagePresentation({
      role: "user",
      createdBy: "system",
      text: "Check your notes.",
      routine,
    });
    expect(presentation).toEqual({ text: "Check your notes.", attribution: "automation", routine });
    expect(routineLabelText(routine)).toBe("Heartbeat · Repeating");
  });

  it("recognizes older scheduler messages by their id", () => {
    for (const trigger of ["scheduled", "manual"]) {
      expect(
        resolveUserMessagePresentation({
          id: `scheduled-task-message:task:daily-audit:1788661140000:${trigger}`,
          role: "user",
          createdBy: "user",
          text: legacyText,
        }),
      ).toEqual({
        text: "Check for crashes.\n",
        attribution: "automation",
        routine: undefined,
      });
    }
  });
});

describe("withoutSilentRoutineWakes", () => {
  const wake = {
    role: "user",
    text: "Check your notes.",
    routine: {
      taskId: ScheduledTaskId.make("task:check"),
      name: "Check",
      trigger: "interval",
    },
  } as const;
  const reply = { role: "assistant", text: "Done." };
  const own = { role: "user", text: "hi" };
  const typing = { role: "typing", text: "" };
  const userMessageOf = (row: { readonly role: string; readonly text: string }) =>
    row.role === "user" ? row : null;

  it("drops wakes nothing followed, and keeps ones that led to a reply or are still running", () => {
    const rows = [wake, wake, own, wake, reply, wake, wake, typing];
    expect(withoutSilentRoutineWakes(rows, userMessageOf)).toEqual([
      own,
      wake,
      reply,
      wake,
      typing,
    ]);
    expect(withoutSilentRoutineWakes([reply, wake], userMessageOf)).toEqual([reply]);
  });
});

describe("foldRepeatedRoutineRuns", () => {
  const wakeOf = (taskId: string) => ({
    role: "user",
    text: "Check.",
    routine: { taskId: ScheduledTaskId.make(taskId), name: taskId, trigger: "interval" },
  });
  const a1 = wakeOf("a");
  const a2 = wakeOf("a");
  const a3 = wakeOf("a");
  const b1 = wakeOf("b");
  const reply = (text: string) => ({ role: "assistant", text });
  const [r1, r2, r3, rb] = [reply("1"), reply("2"), reply("3"), reply("b")];
  const own = { role: "user", text: "hi" };
  const card = { role: "card", text: "" };
  const streaming = { role: "assistant", text: "…", streaming: true };
  const fold = (rows: ReadonlyArray<{ readonly role: string; readonly text: string }>) =>
    foldRepeatedRoutineRuns(rows, {
      userMessageOf: (row) => (row.role === "user" ? row : null),
      isSettledReply: (row) => row.role === "assistant" && !("streaming" in row),
      fold: (group) => ({ fold: group.runs.map((run) => run.wake), taskId: group.routine.taskId }),
    });

  it("folds earlier runs of one routine and keeps the newest in view", () => {
    expect(fold([own, a1, r1, a2, r2, a3, r3, own])).toEqual([
      own,
      { fold: [a1, a2], taskId: "a" },
      a3,
      r3,
      own,
    ]);
  });

  it("leaves lone runs, other routines, and runs with more than replies alone", () => {
    expect(fold([a1, r1, b1, rb, a2, r2])).toEqual([a1, r1, b1, rb, a2, r2]);
    expect(fold([a1, r1, a2, r2, card, a3, r3])).toEqual([a1, r1, a2, r2, card, a3, r3]);
    expect(fold([a1, r1, a2, r2, a3, streaming])).toEqual([
      { fold: [a1], taskId: "a" },
      a2,
      r2,
      a3,
      streaming,
    ]);
  });
});

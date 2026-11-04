import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import { ProjectId, ThreadId } from "./baseSchemas.ts";
import { botMainThreadId } from "./bot.ts";

const projectId = ProjectId.make("bot");
const thread = (
  id: string,
  createdAt: string,
  overrides: { archived?: boolean; other?: boolean } = {},
) => ({
  id: ThreadId.make(id),
  projectId: overrides.other ? ProjectId.make("other") : projectId,
  createdAt,
  archivedAt: overrides.archived ? "2026-02-01T00:00:00.000Z" : null,
});

describe("botMainThreadId", () => {
  it("prefers the recorded main thread over every fallback", () => {
    const threads = [thread("oldest", "2026-01-01T00:00:00.000Z")];
    expect(
      botMainThreadId({ id: projectId, mainThreadId: ThreadId.make("recorded") }, threads),
    ).toBe("recorded");
  });

  it("falls back to the project's oldest unarchived thread, ignoring other projects", () => {
    const threads = [
      thread("newer", "2026-01-03T00:00:00.000Z"),
      thread("archived", "2026-01-01T00:00:00.000Z", { archived: true }),
      thread("elsewhere", "2026-01-01T00:00:00.000Z", { other: true }),
      thread("oldest", "2026-01-02T00:00:00.000Z"),
    ];
    expect(botMainThreadId({ id: projectId, mainThreadId: null }, threads)).toBe("oldest");
    expect(botMainThreadId({ id: projectId }, threads.slice(1, 3))).toBeNull();
  });

  it("orders server shells by instant, not by string", () => {
    const at = (iso: string) => DateTime.makeUnsafe(iso);
    const threads = [
      { ...thread("budapest-8utc", ""), createdAt: at("2026-01-01T10:00:00+02:00") },
      { ...thread("london-9utc", ""), createdAt: at("2026-01-01T09:00:00Z") },
    ];
    expect(botMainThreadId({ id: projectId }, threads)).toBe("budapest-8utc");
  });
});

import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { botAvatarFileName, planBotAvatarExport } from "./botAvatarImage";

const laptop = EnvironmentId.make("environment-laptop");
const vps = EnvironmentId.make("environment-vps");

function bot(environmentId: EnvironmentId, id: string, extra: { archivedAt?: string } = {}) {
  return {
    environmentId,
    id: ProjectId.make(id),
    title: id,
    avatar: null,
    archivedAt: extra.archivedAt ?? null,
  };
}

function written(projects: ReadonlyArray<ReturnType<typeof bot>>) {
  const plan = planBotAvatarExport({
    projects,
    manifest: {},
    exists: () => false,
    isLive: () => false,
  });
  return Object.fromEntries(
    plan.write.map((avatar) => [
      avatar.fileName,
      { signature: avatar.signature, environmentId: avatar.environmentId },
    ]),
  );
}

describe("planBotAvatarExport", () => {
  it("draws only bots whose face changed or whose file went missing", () => {
    const pip = bot(laptop, "pip");
    const manifest = written([pip, bot(laptop, "rex")]);
    const renamed = { ...bot(laptop, "rex"), title: "Rexy" };
    const plan = planBotAvatarExport({
      projects: [pip, renamed],
      manifest,
      exists: (fileName) => fileName !== botAvatarFileName(laptop, "pip"),
      isLive: () => true,
    });
    expect(plan.write.map((avatar) => avatar.fileName).sort()).toEqual(
      [botAvatarFileName(laptop, "pip"), botAvatarFileName(laptop, "rex")].sort(),
    );
    expect(plan.remove).toEqual([]);
  });

  it("deletes archived bots at once, and missing ones only once their environment is live", () => {
    const manifest = written([bot(laptop, "gone"), bot(vps, "offline"), bot(laptop, "shelved")]);
    const plan = planBotAvatarExport({
      projects: [bot(laptop, "shelved", { archivedAt: "2026-11-01T00:00:00.000Z" })],
      manifest,
      exists: () => true,
      isLive: (environmentId) => environmentId === laptop,
    });
    expect(plan.write).toEqual([]);
    expect([...plan.remove].sort()).toEqual(
      [botAvatarFileName(laptop, "gone"), botAvatarFileName(laptop, "shelved")].sort(),
    );
  });
});

describe("botAvatarFileName", () => {
  // NotificationService.swift's avatarFileName must produce the same name.
  it("keeps ids that are unsafe in a path inside one file name", () => {
    expect(botAvatarFileName("env/1", "bot.two")).toBe("env_1--bot_two.png");
  });
});

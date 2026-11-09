import {
  ProjectId,
  SecretRequestError,
  type SecretVault,
  SecretVaultEntryId,
  SecretVaultEntryName,
  SecretVaultId,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  secretKeepVaultId,
  secretRequestDisplay,
  secretRequestKeepOptions,
  secretRequestFailureMessage,
  secretRequestPrivacyNote,
} from "./secretRequest.ts";

describe("secretRequestDisplay", () => {
  it("never offers the form for a request inherited from another thread", () => {
    expect(secretRequestDisplay({ secretStatus: "pending" }, "inherited")).toEqual({
      kind: "pending-elsewhere",
      label: "Waiting for an answer in the original thread",
    });
    expect(secretRequestDisplay({ secretStatus: "saved" }, "inherited")).toMatchObject({
      outcome: "saved",
    });
  });
});

describe("secretRequestPrivacyNote", () => {
  it("does not promise to hide a value that the agent's commands can read", () => {
    expect(secretRequestPrivacyNote({})).toBe("Stored securely, never shown to the agent");
    expect(secretRequestPrivacyNote({ delivery: "file" })).not.toContain("never shown");
  });
});

describe("secretRequestFailureMessage", () => {
  it("passes through server errors but hides anything that could echo the payload", () => {
    expect(
      secretRequestFailureMessage(new SecretRequestError({ reason: "already_answered" })),
    ).toBe("This secret request was already answered.");
    expect(secretRequestFailureMessage(new Error('Expected string, got "whsec_1"'))).toBe(
      "Could not answer the request. Try again.",
    );
    expect(secretRequestFailureMessage(undefined)).toBe("Could not answer the request. Try again.");
  });
});

describe("secretRequestKeepOptions", () => {
  const bot = ProjectId.make("project:assistant");
  const vault = (id: string, projectIds: ReadonlyArray<ProjectId>, names: ReadonlyArray<string>) =>
    ({
      id: SecretVaultId.make(id),
      name: id,
      projectIds,
      createdAt: "2026-11-09T00:00:00.000Z",
      entries: names.map((name) => ({
        id: SecretVaultEntryId.make(`${id}:${name}`),
        name: SecretVaultEntryName.make(name),
        label: name,
        createdAt: "2026-11-09T00:00:00.000Z",
        updatedAt: "2026-11-09T00:00:00.000Z",
        lastUsedAt: null,
      })),
    }) satisfies SecretVault;
  const item = { keepAs: SecretVaultEntryName.make("home-assistant") };

  it("offers only the bot's own vaults, and replaces a kept value where it lives", () => {
    const options = secretRequestKeepOptions(
      item,
      [
        vault("private", [bot], []),
        vault("household", [bot], ["home-assistant"]),
        vault("other-bot", [ProjectId.make("project:coder")], ["home-assistant"]),
      ],
      bot,
    );
    expect(options?.vaults.map((candidate) => candidate.name)).toEqual(["private", "household"]);
    expect(options?.holder).toBe("household");
    expect(secretKeepVaultId(options!, SecretVaultId.make("private"))).toBe("household");
  });

  it("needs a choice only between several vaults; none means a new one", () => {
    const one = secretRequestKeepOptions(item, [vault("private", [bot], [])], bot)!;
    expect(secretKeepVaultId(one, null)).toBe("private");
    const none = secretRequestKeepOptions(item, [], bot)!;
    expect(secretKeepVaultId(none, null)).toBeNull();
    expect(secretRequestKeepOptions({}, [], bot)).toBeNull();
  });
});

import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import {
  claudeHomeFolderSandboxUnavailableReason,
  claudeSandboxFailureMessage,
} from "./claudeHomeFolderSandbox.ts";

const pathWith = Effect.fn("pathWith")(function* (commands: ReadonlyArray<string>) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const bin = yield* fileSystem.makeTempDirectoryScoped({ prefix: "boops-sandbox-bin-" });
  for (const command of commands) {
    const file = path.join(bin, command);
    yield* fileSystem.writeFileString(file, "#!/bin/sh\n");
    yield* fileSystem.chmod(file, 0o755);
  }
  return { PATH: bin };
});

it.layer(NodeServices.layer)("Claude home-folder sandbox", (it) => {
  describe("claudeHomeFolderSandboxUnavailableReason", () => {
    it.effect.each([
      [[], "bubblewrap and socat", "bubblewrap socat"],
      [["bwrap"], "socat", "socat"],
      [["socat"], "bubblewrap", "bubblewrap"],
    ] as const)("on Linux with %j on PATH names what is missing", ([present, needs, install]) =>
      Effect.gen(function* () {
        const reason = yield* claudeHomeFolderSandboxUnavailableReason(yield* pathWith(present));
        expect(reason).toBe(
          `Staying in its home folder needs ${needs} on this machine (sudo apt install ${install}).`,
        );
      }).pipe(Effect.provideService(HostProcess.Platform, "linux"), Effect.scoped),
    );

    it.effect("is available on Linux with bwrap and socat, and off Linux without them", () =>
      Effect.gen(function* () {
        const both = yield* pathWith(["bwrap", "socat"]);
        expect(
          yield* claudeHomeFolderSandboxUnavailableReason(both).pipe(
            Effect.provideService(HostProcess.Platform, "linux"),
          ),
        ).toBeUndefined();
        const none = yield* pathWith([]);
        expect(
          yield* claudeHomeFolderSandboxUnavailableReason(none).pipe(
            Effect.provideService(HostProcess.Platform, "darwin"),
          ),
        ).toBeUndefined();
      }).pipe(Effect.scoped),
    );
  });

  describe("claudeSandboxFailureMessage", () => {
    it("replaces Claude's raw sandbox error with the setup message", () => {
      expect(
        claudeSandboxFailureMessage(
          "Sandbox required but unavailable: socat not installed. Set sandbox.failIfUnavailable=false to run commands without sandboxing.",
        ),
      ).toBe("Staying in its home folder needs socat on this machine (sudo apt install socat).");
      expect(
        claudeSandboxFailureMessage(
          "Sandbox required but unavailable: bubblewrap (bwrap) not installed, socat not installed",
        ),
      ).toBe(
        "Staying in its home folder needs bubblewrap and socat on this machine (sudo apt install bubblewrap socat).",
      );
      expect(claudeSandboxFailureMessage("Sandbox required but unavailable: kernel says no")).toBe(
        "Staying in its home folder needs Claude's sandbox, which cannot start on this machine.",
      );
      expect(claudeSandboxFailureMessage("API Error: 500")).toBeUndefined();
    });
  });
});

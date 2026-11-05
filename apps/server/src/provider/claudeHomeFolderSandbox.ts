import * as HostProcess from "@t3tools/shared/HostProcess";
import { isCommandAvailable } from "@t3tools/shared/shell";
import * as Effect from "effect/Effect";

// Claude Code's Linux sandbox shells out to these; macOS uses the built-in sandbox-exec.
const LINUX_SANDBOX_COMMANDS = [
  {
    command: "bwrap",
    packageName: "bubblewrap",
    missing: /bubblewrap \(bwrap\) not (?:installed|executable)/u,
  },
  { command: "socat", packageName: "socat", missing: /socat not (?:installed|executable)/u },
] as const;

const SANDBOX_UNAVAILABLE = "Sandbox required but unavailable";

const GENERIC_MESSAGE =
  "Staying in its home folder needs Claude's sandbox, which cannot start on this machine.";

function missingPackagesMessage(packages: ReadonlyArray<string>): string {
  return `Staying in its home folder needs ${packages.join(" and ")} on this machine (sudo apt install ${packages.join(" ")}).`;
}

/** Why Claude cannot keep a bot in its home folder on this host, or undefined when it can. */
export const claudeHomeFolderSandboxUnavailableReason = Effect.fn(
  "claudeHomeFolderSandboxUnavailableReason",
)(function* (env: NodeJS.ProcessEnv) {
  if ((yield* HostProcess.Platform) !== "linux") return undefined;
  const missing: Array<string> = [];
  for (const { command, packageName } of LINUX_SANDBOX_COMMANDS) {
    if (!(yield* isCommandAvailable(command, { env }))) missing.push(packageName);
  }
  return missing.length === 0 ? undefined : missingPackagesMessage(missing);
});

/** Replaces Claude's raw "Sandbox required but unavailable" text with what the user can do about it. */
export function claudeSandboxFailureMessage(message: string): string | undefined {
  if (!message.includes(SANDBOX_UNAVAILABLE)) return undefined;
  const missing = LINUX_SANDBOX_COMMANDS.filter((entry) => entry.missing.test(message)).map(
    (entry) => entry.packageName,
  );
  return missing.length === 0 ? GENERIC_MESSAGE : missingPackagesMessage(missing);
}

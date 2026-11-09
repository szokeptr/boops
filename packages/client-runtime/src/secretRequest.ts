import type {
  OrchestrationV2TurnItem,
  ProjectId,
  SecretRequestAnswerInput,
  SecretVault,
  SecretVaultId,
} from "@t3tools/contracts";

export type SecretRequestItem = Extract<
  OrchestrationV2TurnItem,
  { readonly type: "secret_request" }
>;

/**
 * A `file` request lets the agent's commands read the value, so its card must not promise more.
 * A kept value can be handed out as a file later, so keeping it promises the least.
 */
export const secretRequestPrivacyNote = (
  item: Pick<SecretRequestItem, "delivery">,
  keepingIn?: string,
) =>
  keepingIn !== undefined
    ? `Kept out of chat, in ${keepingIn} until you remove it. This bot's commands can read it`
    : item.delivery === "file"
      ? "Kept out of chat, in a private file this agent's commands can read for 24 hours"
      : "Stored securely, never shown to the agent";

/**
 * Where a value the agent asked to keep would go. `holder` already has an entry of that name, so
 * saving replaces it there. With no vault, the server makes one named after the bot.
 */
export interface SecretKeepOptions {
  readonly name: string;
  readonly vaults: ReadonlyArray<{ readonly id: SecretVaultId; readonly name: string }>;
  readonly holder: SecretVaultId | null;
}

export function secretRequestKeepOptions(
  item: Pick<SecretRequestItem, "keepAs">,
  vaults: ReadonlyArray<SecretVault>,
  projectId: ProjectId | null,
): SecretKeepOptions | null {
  if (item.keepAs === undefined || projectId === null) return null;
  const name = item.keepAs;
  const granted = vaults.filter((vault) => vault.projectIds.includes(projectId));
  return {
    name,
    vaults: granted.map((vault) => ({ id: vault.id, name: vault.name })),
    holder: granted.find((vault) => vault.entries.some((entry) => entry.name === name))?.id ?? null,
  };
}

/** The vault a keep answer names: the holder, the chosen one, the only one, or a new one. */
export function secretKeepVaultId(
  options: SecretKeepOptions,
  chosen: SecretVaultId | null,
): SecretVaultId | null {
  return options.holder ?? chosen ?? (options.vaults.length === 1 ? options.vaults[0]!.id : null);
}

/** The vault's name for the privacy note, or the new vault's when the bot has none. */
export function secretKeepVaultLabel(
  options: SecretKeepOptions,
  vaultId: SecretVaultId | null,
  botName: string,
): string {
  const vault = options.vaults.find((candidate) => candidate.id === vaultId);
  return vault !== undefined
    ? vault.name
    : options.vaults.length === 0
      ? `a new vault, ${botName}`
      : "the vault you choose";
}
export const SECRET_REQUEST_DEFAULT_PLACEHOLDER = "Paste the secret";

export type SecretRequestDisplay =
  | { readonly kind: "pending" }
  | { readonly kind: "pending-elsewhere"; readonly label: string }
  | {
      readonly kind: "answered";
      readonly outcome: "saved" | "declined" | "ended";
      readonly label: string;
    };

const SAVED_DISPLAY: SecretRequestDisplay = {
  kind: "answered",
  outcome: "saved",
  label: "Saved securely and kept private",
};
const DECLINED_DISPLAY: SecretRequestDisplay = {
  kind: "answered",
  outcome: "declined",
  label: "Declined",
};
const ENDED_DISPLAY: SecretRequestDisplay = {
  kind: "answered",
  outcome: "ended",
  label: "Request ended",
};
const PENDING_DISPLAY: SecretRequestDisplay = { kind: "pending" };
const PENDING_ELSEWHERE_DISPLAY: SecretRequestDisplay = {
  kind: "pending-elsewhere",
  label: "Waiting for an answer in the original thread",
};

/**
 * `visibility` is the projected row's: a request inherited from another
 * thread (a fork) can only be answered where it was asked.
 */
export function secretRequestDisplay(
  item: Pick<SecretRequestItem, "secretStatus" | "keptIn">,
  visibility: "local" | "inherited" | "synthetic",
): SecretRequestDisplay {
  switch (item.secretStatus) {
    case "pending":
      return visibility === "local" ? PENDING_DISPLAY : PENDING_ELSEWHERE_DISPLAY;
    case "saved":
      return item.keptIn === undefined
        ? SAVED_DISPLAY
        : { kind: "answered", outcome: "saved", label: `Kept in ${item.keptIn}` };
    case "declined":
      return DECLINED_DISPLAY;
    case "cancelled":
      return ENDED_DISPLAY;
  }
}

export function secretRequestAnswerInput(
  item: Pick<SecretRequestItem, "id" | "threadId">,
  answer:
    | {
        readonly type: "save";
        readonly secret: string;
        readonly keep?: { readonly vaultId: SecretVaultId | null } | undefined;
      }
    | { readonly type: "decline" },
): SecretRequestAnswerInput | null {
  if (answer.type === "decline") {
    return { threadId: item.threadId, turnItemId: item.id, answer: { type: "decline" } };
  }
  const secret = answer.secret.trim();
  if (secret.length === 0) return null;
  return {
    threadId: item.threadId,
    turnItemId: item.id,
    answer: {
      type: "save",
      secret,
      ...(answer.keep === undefined ? {} : { keep: answer.keep }),
    },
  };
}

const USER_FACING_FAILURE_TAGS = new Set([
  "SecretRequestError",
  "SecretVaultError",
  "EnvironmentAuthorizationError",
]);

/**
 * Only known server errors pass their message through: anything else (transport or encoding
 * failures) gets the generic copy, so the typed value can never surface in the UI.
 */
export function secretRequestFailureMessage(failure: unknown): string {
  if (
    typeof failure === "object" &&
    failure !== null &&
    "_tag" in failure &&
    typeof failure._tag === "string" &&
    USER_FACING_FAILURE_TAGS.has(failure._tag) &&
    "message" in failure &&
    typeof failure.message === "string" &&
    failure.message.trim().length > 0
  ) {
    return failure.message;
  }
  return "Could not answer the request. Try again.";
}

/** For Settings: a vault error's own message, anything else a generic one. */
export function secretVaultFailureMessage(failure: unknown): string {
  return typeof failure === "object" &&
    failure !== null &&
    "_tag" in failure &&
    USER_FACING_FAILURE_TAGS.has(String(failure._tag)) &&
    "message" in failure &&
    typeof failure.message === "string"
    ? failure.message
    : "Something went wrong. Try again.";
}

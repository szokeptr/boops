import * as Schema from "effect/Schema";

import {
  IsoDateTime,
  ProjectId,
  SecretVaultEntryId,
  SecretVaultId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";

/**
 * A vault is a named set of secrets a bot keeps across threads and routines. The user grants
 * vaults per bot; agents reach entries by name through `request_secret` and never see values here.
 */
export const SecretVaultName = TrimmedNonEmptyString.check(Schema.isMaxLength(80));
export type SecretVaultName = typeof SecretVaultName.Type;

/** How agents ask for an entry, e.g. `home-assistant`. */
export const SecretVaultEntryName = TrimmedNonEmptyString.check(
  Schema.isMaxLength(64),
  Schema.isPattern(/^[a-z0-9]+(?:[-_.][a-z0-9]+)*$/),
);
export type SecretVaultEntryName = typeof SecretVaultEntryName.Type;

export const SecretVaultEntryLabel = TrimmedNonEmptyString.check(Schema.isMaxLength(120));

export const SecretVaultEntry = Schema.Struct({
  id: SecretVaultEntryId,
  name: SecretVaultEntryName,
  label: SecretVaultEntryLabel,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  lastUsedAt: Schema.NullOr(IsoDateTime),
});
export type SecretVaultEntry = typeof SecretVaultEntry.Type;

export const SecretVault = Schema.Struct({
  id: SecretVaultId,
  name: SecretVaultName,
  /** The bots that can use this vault's entries. */
  projectIds: Schema.Array(ProjectId),
  entries: Schema.Array(SecretVaultEntry),
  createdAt: IsoDateTime,
});
export type SecretVault = typeof SecretVault.Type;

export const SecretVaultsSnapshot = Schema.Struct({ vaults: Schema.Array(SecretVault) });
export type SecretVaultsSnapshot = typeof SecretVaultsSnapshot.Type;

export const SecretVaultsCreateInput = Schema.Struct({
  name: SecretVaultName,
  projectIds: Schema.optional(Schema.Array(ProjectId)),
});
export type SecretVaultsCreateInput = typeof SecretVaultsCreateInput.Type;

export const SecretVaultsRenameInput = Schema.Struct({
  vaultId: SecretVaultId,
  name: SecretVaultName,
});
export type SecretVaultsRenameInput = typeof SecretVaultsRenameInput.Type;

export const SecretVaultsRemoveInput = Schema.Struct({ vaultId: SecretVaultId });
export type SecretVaultsRemoveInput = typeof SecretVaultsRemoveInput.Type;

export const SecretVaultsSetBotInput = Schema.Struct({
  vaultId: SecretVaultId,
  projectId: ProjectId,
  enabled: Schema.Boolean,
});
export type SecretVaultsSetBotInput = typeof SecretVaultsSetBotInput.Type;

/** Adds an entry, or replaces the value and label of the entry with that name. */
export const SecretVaultsPutEntryInput = Schema.Struct({
  vaultId: SecretVaultId,
  name: SecretVaultEntryName,
  label: SecretVaultEntryLabel,
  value: TrimmedNonEmptyString,
});
export type SecretVaultsPutEntryInput = typeof SecretVaultsPutEntryInput.Type;

export const SecretVaultsRemoveEntryInput = Schema.Struct({ entryId: SecretVaultEntryId });
export type SecretVaultsRemoveEntryInput = typeof SecretVaultsRemoveEntryInput.Type;

const SECRET_VAULT_ERROR_MESSAGES = {
  vault_not_found: "That vault no longer exists.",
  entry_not_found: "That secret no longer exists.",
  bot_not_found: "That bot no longer exists.",
  vault_required: "Choose which vault to keep this secret in.",
  store_failed: "Could not store the secret.",
  read_failed: "Could not read the secret.",
  persistence_failed: "Could not update vaults.",
} as const;

export const SecretVaultErrorReason = Schema.Literals(
  Object.keys(SECRET_VAULT_ERROR_MESSAGES) as Array<keyof typeof SECRET_VAULT_ERROR_MESSAGES>,
);
export type SecretVaultErrorReason = typeof SecretVaultErrorReason.Type;

export class SecretVaultError extends Schema.TaggedError<SecretVaultError>()("SecretVaultError", {
  reason: SecretVaultErrorReason,
  cause: Schema.optionalKey(Schema.Defect()),
}) {
  override get message(): string {
    return SECRET_VAULT_ERROR_MESSAGES[this.reason];
  }
}

export const OrchestratorMcpListSecretsResult = Schema.Struct({
  secrets: Schema.Array(
    Schema.Struct({
      name: SecretVaultEntryName,
      label: Schema.String,
      vault: Schema.String,
    }),
  ),
});
export type OrchestratorMcpListSecretsResult = typeof OrchestratorMcpListSecretsResult.Type;

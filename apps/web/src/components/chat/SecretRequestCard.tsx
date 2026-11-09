import { pipe } from "effect/Function";
import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  SECRET_REQUEST_DEFAULT_PLACEHOLDER,
  secretKeepVaultId,
  secretKeepVaultLabel,
  secretRequestAnswerInput,
  secretRequestDisplay,
  secretRequestFailureMessage,
  secretRequestKeepOptions,
  secretRequestPrivacyNote,
  type SecretRequestItem,
} from "@t3tools/client-runtime/secret-request";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type {
  EnvironmentId,
  OrchestrationV2ProjectedTurnItem,
  SecretVaultId,
} from "@t3tools/contracts";
import { CheckIcon, LockIcon, MinusIcon, ShieldCheckIcon } from "lucide-react";
import { useId, useRef, useState, type FormEvent } from "react";

import { useProject, useThreadShell } from "../../state/entities";
import { useSecretVaults } from "../../state/secretVaults";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { WorkLogRow } from "./WorkLog";

export function SecretRequestCard(props: {
  readonly environmentId: EnvironmentId;
  readonly item: SecretRequestItem;
  readonly visibility: OrchestrationV2ProjectedTurnItem["visibility"];
}) {
  const { item } = props;
  const display = secretRequestDisplay(item, props.visibility);
  if (display.kind === "answered" || display.kind === "pending-elsewhere") {
    const Icon =
      display.kind === "pending-elsewhere"
        ? LockIcon
        : display.outcome === "saved"
          ? CheckIcon
          : MinusIcon;
    return (
      <WorkLogRow
        data-v2-item-type={item.type}
        icon={<Icon className="size-3.5 text-icon-muted" aria-hidden />}
        label={
          <>
            {item.label} · {display.label}
          </>
        }
      />
    );
  }
  return <PendingSecretRequestForm environmentId={props.environmentId} item={item} />;
}

function PendingSecretRequestForm(props: {
  readonly environmentId: EnvironmentId;
  readonly item: SecretRequestItem;
}) {
  const { item, environmentId } = props;
  const inputId = useId();
  const errorId = useId();
  const privacyId = useId();
  const shell = useThreadShell(scopeThreadRef(environmentId, item.threadId));
  const bot = useProject(shell === null ? null : scopeProjectRef(environmentId, shell.projectId));
  const { vaults } = useSecretVaults(item.keepAs === undefined ? null : environmentId);
  const keepOptions = secretRequestKeepOptions(item, vaults, bot?.id ?? null);
  const botName = bot?.title ?? "this bot";
  const [keep, setKeep] = useState(true);
  const [chosenVault, setChosenVault] = useState<SecretVaultId | null>(null);
  const keepVaultId =
    keepOptions === null
      ? null
      : secretKeepVaultId(keepOptions, chosenVault ?? keepOptions.vaults[0]?.id ?? null);
  const keeping = keepOptions !== null && keep;
  const answer = useAtomCommand(serverEnvironment.answerSecretRequest, {
    label: "answer secret request",
    // The failure cause holds the request; keep it out of the console.
    reportFailure: false,
    reportDefect: false,
  });
  const [secret, setSecret] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Enter and click can both submit before a render.
  const inFlight = useRef(false);

  const send = async (
    reply:
      | {
          readonly type: "save";
          readonly secret: string;
          readonly keep?: { readonly vaultId: SecretVaultId | null } | undefined;
        }
      | { readonly type: "decline" },
  ) => {
    const input = secretRequestAnswerInput(item, reply);
    if (input === null || inFlight.current) return;
    inFlight.current = true;
    setSubmitting(true);
    setError(null);
    const result = await answer({ environmentId: props.environmentId, input }).finally(() => {
      inFlight.current = false;
      setSubmitting(false);
    });
    if (result._tag === "Success") {
      setSecret("");
      return;
    }
    if (!isAtomCommandInterrupted(result)) {
      pipe(squashAtomCommandFailure(result), secretRequestFailureMessage, setError);
    }
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void send({ type: "save", secret, keep: keeping ? { vaultId: keepVaultId } : undefined });
  };

  return (
    <form
      data-v2-item-type={item.type}
      className="flex min-w-0 flex-col gap-3 rounded-xl border border-border/60 bg-card p-4"
      onSubmit={onSubmit}
      autoComplete="off"
      // On click, not pointerdown: the mousedown that follows a pointerdown
      // moves focus back off the input. A click that ends a text selection
      // leaves it alone so the reason can still be copied.
      onClick={(event) => {
        if (!(event.target instanceof Element)) return;
        if (event.target.closest("input, button, a")) return;
        if (window.getSelection()?.isCollapsed === false) return;
        document.getElementById(inputId)?.focus();
      }}
    >
      <div className="flex min-w-0 flex-col gap-1">
        <label htmlFor={inputId} className="text-sm font-medium text-foreground">
          {item.label}
        </label>
        {item.reason.trim() ? (
          <p className="text-sm wrap-anywhere text-muted-foreground">{item.reason}</p>
        ) : null}
        {item.replace === true && keepOptions?.holder != null ? (
          <p className="text-sm text-muted-foreground">
            The kept value stopped working. Saving replaces it.
          </p>
        ) : null}
      </div>
      <div className="flex min-w-0 items-center gap-2">
        <div className="min-w-0 flex-1">
          <Input
            id={inputId}
            // Password fields prompt to save credentials; this secret is not a login.
            type="text"
            className="[-webkit-text-security:disc]"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            data-1p-ignore
            data-lpignore="true"
            data-bwignore
            placeholder={item.placeholder ?? SECRET_REQUEST_DEFAULT_PLACEHOLDER}
            value={secret}
            disabled={submitting}
            aria-invalid={error !== null || undefined}
            aria-describedby={error !== null ? `${privacyId} ${errorId}` : privacyId}
            onChange={(event) => setSecret(event.currentTarget.value)}
          />
        </div>
        <Button type="submit" disabled={submitting || secret.trim().length === 0}>
          Save securely
        </Button>
      </div>
      {keepOptions !== null ? (
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5 text-sm">
          <label className="flex min-w-0 items-center gap-2">
            <Checkbox
              checked={keep}
              disabled={submitting}
              onCheckedChange={(checked) => setKeep(checked === true)}
            />
            <span className="min-w-0">
              Keep for {botName} as{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">{keepOptions.name}</code>
            </span>
          </label>
          {keep && keepOptions.holder === null && keepOptions.vaults.length > 1 ? (
            <Select
              value={keepVaultId ?? ""}
              disabled={submitting}
              onValueChange={(value) => {
                if (value !== null) setChosenVault(value as SecretVaultId);
              }}
            >
              <SelectTrigger aria-label="Vault" size="xs">
                <SelectValue>
                  {keepOptions.vaults.find((vault) => vault.id === keepVaultId)?.name}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup>
                {keepOptions.vaults.map((vault) => (
                  <SelectItem key={vault.id} value={vault.id}>
                    {vault.name}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          ) : null}
        </div>
      ) : null}
      {error !== null ? (
        <p id={errorId} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
      <div className="flex min-w-0 items-center justify-between gap-2">
        <p
          id={privacyId}
          className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground"
        >
          <ShieldCheckIcon className="size-3.5 shrink-0" aria-hidden />
          {secretRequestPrivacyNote(
            item,
            keeping ? secretKeepVaultLabel(keepOptions, keepVaultId, botName) : undefined,
          )}
        </p>
        <Button
          type="button"
          size="xs"
          variant="ghost-muted"
          disabled={submitting}
          onClick={() => void send({ type: "decline" })}
        >
          Decline
        </Button>
      </div>
    </form>
  );
}

import { connectorClientGuide } from "@t3tools/client-runtime/connectors";
import type { ConnectorOAuthClientInput } from "@t3tools/contracts";
import { Check, Copy } from "lucide";
import { useId, useState } from "react";

import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";

import { MorphIcon } from "../MorphIcon";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import type { ConnectorClientPrompt } from "./useConnectorSignIn";

/**
 * Asks for an OAuth client the user created with the provider, for a server without client
 * registration. Shows the catalog's steps and the redirect URI and scopes to register.
 */
export function ConnectorClientDialog(props: {
  readonly prompt: ConnectorClientPrompt;
  readonly busy: boolean;
  readonly onSubmit: (client: ConnectorOAuthClientInput) => Promise<string | null>;
  readonly onClose: () => void;
}) {
  const formId = useId();
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { prompt } = props;
  const { setup, scopes } = connectorClientGuide(prompt.entry);
  // Catalog providers with a setup guide (Google) issue confidential clients only.
  const needsSecret = setup !== null;
  const ready = clientId.trim().length > 0 && (!needsSecret || clientSecret.trim().length > 0);

  const submit = async () => {
    if (!ready) return;
    const secret = clientSecret.trim();
    setError(
      await props.onSubmit({
        clientId: clientId.trim(),
        ...(secret.length === 0 ? {} : { clientSecret: secret }),
      }),
    );
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !props.busy) props.onClose();
      }}
    >
      <DialogPopup className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {prompt.kind === "new" ? `Connect ${prompt.name}` : `Sign in to ${prompt.name} again`}
          </DialogTitle>
          <DialogDescription>
            {prompt.name} needs an OAuth client you create. Its secret stays on the server.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <form
            id={formId}
            className="grid gap-4"
            autoComplete="off"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            {setup !== null ? (
              <div className="grid gap-1.5 text-sm">
                <ol className="grid list-decimal gap-1 pl-5 text-muted-foreground">
                  {setup.steps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
                <a
                  href={setup.docsUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs underline underline-offset-2"
                >
                  Full setup guide
                </a>
              </div>
            ) : null}
            <CopyField label="Redirect URI" value={prompt.redirectUri} />
            {scopes.length > 0 ? <CopyField label="Scopes" value={scopes.join(",")} /> : null}
            <div className="grid gap-1.5">
              <Label htmlFor={`${formId}-id`}>Client ID</Label>
              <Input
                id={`${formId}-id`}
                value={clientId}
                onChange={(event) => setClientId(event.target.value)}
                disabled={props.busy}
                spellCheck={false}
                autoFocus
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={`${formId}-secret`}>
                {needsSecret ? "Client secret" : "Client secret (if it has one)"}
              </Label>
              <Input
                id={`${formId}-secret`}
                type="password"
                value={clientSecret}
                onChange={(event) => setClientSecret(event.target.value)}
                disabled={props.busy}
                spellCheck={false}
              />
            </div>
            {error !== null ? (
              <p role="alert" className="text-xs text-destructive">
                {error}
              </p>
            ) : null}
          </form>
        </DialogPanel>
        <DialogFooter variant="bare">
          <Button variant="outline" disabled={props.busy} onClick={props.onClose}>
            Cancel
          </Button>
          <Button type="submit" form={formId} disabled={props.busy || !ready}>
            {props.busy ? "Opening…" : "Continue to sign in"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

function CopyField(props: { readonly label: string; readonly value: string }) {
  const id = useId();
  const { copyToClipboard, isCopied } = useCopyToClipboard({ timeout: 1500, target: "text" });
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{props.label}</Label>
      <div className="flex items-center gap-1">
        <div className="min-w-0 flex-1">
          <Input id={id} size="sm" value={props.value} readOnly spellCheck={false} />
        </div>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={`Copy ${props.label.toLowerCase()}`}
          onClick={() => copyToClipboard(props.value, undefined)}
        >
          <MorphIcon className="size-3.5" icon={isCopied ? Check : Copy} />
        </Button>
      </div>
    </div>
  );
}

import { useId, useState } from "react";

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
import type { ConnectorKeyPrompt } from "./useConnectorSignIn";

/**
 * Asks for an API key. A catalog entry names its header; a server added by URL lets the user
 * name one. The key lives only in this dialog's state and the request.
 */
export function ConnectorKeyDialog(props: {
  readonly prompt: ConnectorKeyPrompt;
  readonly busy: boolean;
  readonly onSubmit: (apiKey: string, headerName?: string) => Promise<string | null>;
  readonly onClose: () => void;
}) {
  const formId = useId();
  const [apiKey, setApiKey] = useState("");
  const [headerName, setHeaderName] = useState("Authorization");
  const [error, setError] = useState<string | null>(null);
  const { prompt } = props;
  const name = prompt.kind === "new" ? prompt.choice.name : prompt.connection.displayName;
  const entryAuth = prompt.kind === "new" ? prompt.choice.entry?.auth : undefined;
  const hint = entryAuth?.kind === "api-key" ? entryAuth.hint : null;
  const docsUrl = prompt.kind === "new" ? prompt.choice.entry?.docsUrl : undefined;
  const asksHeader = prompt.kind === "new" && "url" in prompt.choice.target;

  const submit = async () => {
    const key = apiKey.trim();
    if (key.length === 0) return;
    const header = headerName.trim();
    setError(await props.onSubmit(key, asksHeader && header.length > 0 ? header : undefined));
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !props.busy) props.onClose();
      }}
    >
      <DialogPopup className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {prompt.kind === "new" ? `Connect ${name}` : `Sign in to ${name} again`}
          </DialogTitle>
          <DialogDescription>
            The key stays on the server. Bots use {name} through it and never see the key.
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
            <div className="grid gap-1.5">
              <Label htmlFor={`${formId}-key`}>API key</Label>
              <Input
                id={`${formId}-key`}
                type="password"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                disabled={props.busy}
                spellCheck={false}
                autoFocus
              />
              {hint || docsUrl ? (
                <p className="text-xs text-muted-foreground">
                  {hint}
                  {hint && docsUrl ? " " : null}
                  {docsUrl ? (
                    <a
                      href={docsUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="underline underline-offset-2"
                    >
                      Docs
                    </a>
                  ) : null}
                </p>
              ) : null}
            </div>
            {asksHeader ? (
              <div className="grid gap-1.5">
                <Label htmlFor={`${formId}-header`}>Header</Label>
                <Input
                  id={`${formId}-header`}
                  value={headerName}
                  onChange={(event) => setHeaderName(event.target.value)}
                  disabled={props.busy}
                  spellCheck={false}
                />
                <p className="text-xs text-muted-foreground">
                  Authorization keys are sent as Bearer tokens.
                </p>
              </div>
            ) : null}
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
          <Button type="submit" form={formId} disabled={props.busy || apiKey.trim().length === 0}>
            {props.busy ? "Connecting…" : "Connect"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

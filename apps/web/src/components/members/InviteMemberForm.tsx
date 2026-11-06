import { Link } from "@tanstack/react-router";
import { useId, useState, type ReactNode } from "react";

import { Button, InlineButton } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function parseInvite(
  name: string,
  email: string,
): { readonly label: string; readonly email: string } | { readonly error: string } {
  const label = name.trim();
  const address = email.trim();
  if (label.length === 0) return { error: "Add their name." };
  if (!EMAIL_PATTERN.test(address)) return { error: "Enter the email they sign in with." };
  return { label, email: address };
}

/** Members arrive through Boops Connect, so inviting waits until it is on. */
export function ConnectRequiredNote(props: { readonly onNavigate?: () => void }) {
  return (
    <p className="text-muted-foreground text-sm">
      Inviting people needs Boops Connect, so they can reach this machine from their phone.{" "}
      <InlineButton
        render={
          <Link to="/settings/access" hash="connections-environment" onClick={props.onNavigate} />
        }
      >
        Turn on Boops Connect
      </InlineButton>
    </p>
  );
}

/** Name and email of someone to invite; `children` sits between the fields and the button. */
export function InviteMemberForm(props: {
  readonly disabled?: boolean;
  readonly autoFocus?: boolean;
  readonly submitLabel: string;
  readonly onInvite: (input: {
    readonly label: string;
    readonly email: string;
  }) => Promise<boolean>;
  readonly children?: ReactNode;
}) {
  const id = useId();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submit = async () => {
    if (submitting) return;
    const parsed = parseInvite(name, email);
    if ("error" in parsed) {
      setError(parsed.error);
      return;
    }
    setError(null);
    setSubmitting(true);
    const invited = await props.onInvite(parsed);
    setSubmitting(false);
    if (invited) {
      setName("");
      setEmail("");
    }
  };
  const disabled = props.disabled === true || submitting;
  return (
    <form
      aria-label="Invite someone"
      className="flex flex-col gap-3"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${id}-name`}>Name</Label>
          <Input
            id={`${id}-name`}
            value={name}
            onChange={(event) => setName(event.target.value)}
            disabled={disabled}
            maxLength={100}
            autoComplete="off"
            autoFocus={props.autoFocus}
            placeholder="Anna"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${id}-email`}>Email</Label>
          <Input
            id={`${id}-email`}
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            disabled={disabled}
            autoComplete="off"
            placeholder="anna@example.com"
          />
        </div>
      </div>
      {props.children}
      {error ? (
        <p role="alert" className="text-destructive-foreground text-sm">
          {error}
        </p>
      ) : null}
      <div className="flex justify-end">
        <Button type="submit" size="sm" disabled={disabled}>
          {props.submitLabel}
        </Button>
      </div>
    </form>
  );
}

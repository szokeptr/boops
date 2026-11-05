import { useState } from "react";

import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";

/** Rewrites a sent message in its bubble. Sending replaces it and drops every later turn. */
export function UserMessageEditor(props: {
  readonly initialText: string;
  readonly onCancel: () => void;
  readonly onSend: (text: string) => Promise<boolean>;
}) {
  const [text, setText] = useState(props.initialText);
  const [sending, setSending] = useState(false);
  const canSend = !sending && text.trim().length > 0 && text.trim() !== props.initialText.trim();
  const send = async () => {
    if (!canSend) return;
    setSending(true);
    const sent = await props.onSend(text);
    setSending(false);
    if (sent) props.onCancel();
  };
  return (
    <div className="flex flex-col gap-2">
      <Textarea
        aria-label="Edit message"
        autoFocus
        value={text}
        disabled={sending}
        onChange={(event) => setText(event.target.value)}
        onFocus={(event) => {
          const end = event.target.value.length;
          event.target.setSelectionRange(end, end);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            props.onCancel();
          } else if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            void send();
          }
        }}
      />
      <p className="text-muted-foreground text-xs">
        Sending replaces this message and drops everything after it. Files stay as they are.
      </p>
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" disabled={sending} onClick={props.onCancel}>
          Cancel
        </Button>
        <Button size="sm" disabled={!canSend} onClick={() => void send()}>
          Send
        </Button>
      </div>
    </div>
  );
}

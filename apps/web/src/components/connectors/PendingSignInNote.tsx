import { ExternalLinkIcon } from "lucide-react";

import { Alert, AlertAction, AlertDescription } from "../ui/alert";
import { Button } from "../ui/button";

/** Sign-in finishes in another tab; the subscribe stream ends this note when it lands. */
export function PendingSignInNote(props: {
  readonly name: string;
  readonly onReopen: () => void;
  readonly onCancel: () => void;
}) {
  return (
    <Alert variant="info">
      <ExternalLinkIcon aria-hidden />
      <AlertDescription>
        Finish signing in to {props.name} in the browser. This updates when you're done.
      </AlertDescription>
      <AlertAction>
        <Button size="xs" variant="outline" onClick={props.onReopen}>
          Open again
        </Button>
        <Button size="xs" variant="ghost" onClick={props.onCancel}>
          Dismiss
        </Button>
      </AlertAction>
    </Alert>
  );
}

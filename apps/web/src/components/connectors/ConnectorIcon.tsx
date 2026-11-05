import { connectorMonogram } from "@t3tools/client-runtime/connectors";
import { useState } from "react";

import { cn } from "~/lib/utils";

/** The service's own icon, or its initial when there is none or it fails to load. */
export function ConnectorIcon(props: {
  readonly name: string;
  readonly iconUrl: string | null | undefined;
  readonly className?: string;
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const url = props.iconUrl ?? null;
  const box = cn(
    "flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border/60 bg-background",
    props.className,
  );
  if (url === null || failedUrl === url) {
    return (
      <span aria-hidden className={cn(box, "text-sm font-semibold text-muted-foreground")}>
        {connectorMonogram(props.name)}
      </span>
    );
  }
  return (
    <span aria-hidden className={box}>
      <img
        src={url}
        alt=""
        className="size-5"
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setFailedUrl(url)}
      />
    </span>
  );
}

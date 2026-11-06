import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { resolveUserMessagePresentation } from "@t3tools/client-runtime/user-message";
import type { ProjectId } from "@t3tools/contracts";
import { shouldPreserveAssistantLineBreaks } from "@t3tools/shared/markdownPipeline";
import { ChevronDownIcon } from "lucide-react";
import { Fragment, use, useState } from "react";

import { cn } from "~/lib/utils";
import { useProject, useThreadShell } from "../../state/entities";
import ChatMarkdown from "../ChatMarkdown";
import { BotAvatar } from "../bots/BotAvatar";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible";
import type { BotExchangeEntry } from "./MessagesTimeline.logic";
import { MESSAGE_HEADING_LEVEL } from "./TimelineRowParts";
import { TimelineRowCtx, type TimelineRow } from "./timelineRowContext";

interface Peer {
  readonly name: string | null;
  readonly projectId: ProjectId | null;
}

function usePeerProject(projectId: ProjectId | null) {
  const ctx = use(TimelineRowCtx);
  return useProject(
    projectId === null ? null : scopeProjectRef(ctx.activeThreadEnvironmentId, projectId),
  );
}

function PeerAvatar(props: { readonly peer: Peer }) {
  const project = usePeerProject(props.peer.projectId);
  return (
    <BotAvatar
      avatar={project?.avatar ?? null}
      name={project?.title ?? props.peer.name ?? "Bot"}
      status="idle"
      size={16}
      className="shrink-0"
    />
  );
}

function PeerName(props: { readonly peer: Peer }) {
  const project = usePeerProject(props.peer.projectId);
  return <>{project?.title ?? props.peer.name ?? "a bot"}</>;
}

function PeerNames(props: { readonly peers: ReadonlyArray<Peer> }) {
  return props.peers.map((peer, index) => (
    <Fragment key={peer.projectId ?? peer.name ?? index}>
      {index === 0 ? null : index === props.peers.length - 1 ? " and " : ", "}
      <PeerName peer={peer} />
    </Fragment>
  ));
}

/** What the pill says: the send in flight until the other bot answers, then the talk. */
function exchangeVerb(entries: ReadonlyArray<BotExchangeEntry>): string {
  if (entries.some((entry) => entry.kind === "message" && entry.message.role === "user")) {
    return "Talked with";
  }
  const last = entries.findLast((entry) => entry.kind === "sent");
  return last?.kind !== "sent"
    ? "Talked with"
    : last.status === "sending"
      ? "Messaging"
      : last.status === "failed"
        ? "Couldn't message"
        : "Messaged";
}

/** Talk between this bot and its parent or child bot, folded to a pill that opens a mini thread. */
export function BotExchangeTimelineRow({
  row,
}: {
  row: Extract<TimelineRow, { kind: "bot-exchange" }>;
}) {
  const ctx = use(TimelineRowCtx);
  const own = useThreadShell(ctx.threadRef);
  const [expanded, setExpanded] = useState(() =>
    ctx.workGroupViewState.expandedEntries.has(row.id),
  );
  const toggle = (open: boolean) => {
    ctx.onToggleWorkEntry(row.id, expanded);
    if (open) ctx.workGroupViewState.expandedEntries.add(row.id);
    else ctx.workGroupViewState.expandedEntries.delete(row.id);
    setExpanded(open);
  };
  const verb = exchangeVerb(row.entries);
  const ownPeer: Peer = { name: ctx.assistantName, projectId: own?.projectId ?? null };

  return (
    <Collapsible open={expanded} onOpenChange={toggle}>
      <div className="flex justify-center">
        <CollapsibleTrigger className="flex max-w-full items-center gap-2 rounded-full border border-border/70 px-3 py-1.5 text-muted-foreground text-xs transition-colors hover:text-foreground">
          <span className="flex shrink-0 items-center -space-x-1" aria-hidden>
            {row.peers.slice(0, 3).map((peer, index) => (
              <PeerAvatar key={peer.projectId ?? peer.name ?? index} peer={peer} />
            ))}
          </span>
          <span className="truncate">
            {verb}{" "}
            <span className="font-medium text-foreground">
              <PeerNames peers={row.peers} />
            </span>
            {verb === "Messaging" ? "…" : null}
          </span>
          {row.entries.length > 1 ? (
            <span className="shrink-0 tabular-nums">· {row.entries.length}</span>
          ) : null}
          <ChevronDownIcon
            aria-hidden
            className={cn("size-3.5 shrink-0 transition-transform", expanded && "rotate-180")}
          />
        </CollapsibleTrigger>
      </div>
      <CollapsiblePanel>
        <ol className="mt-2 flex flex-col gap-3 rounded-2xl border border-border/70 p-3">
          {row.entries.map((entry) => (
            <ExchangeEntry
              key={entry.kind === "message" ? entry.message.id : entry.id}
              entry={entry}
              ownPeer={ownPeer}
            />
          ))}
        </ol>
      </CollapsiblePanel>
    </Collapsible>
  );
}

function ExchangeEntry(props: { readonly entry: BotExchangeEntry; readonly ownPeer: Peer }) {
  const ctx = use(TimelineRowCtx);
  const { entry } = props;
  const bot =
    entry.kind === "message" ? resolveUserMessagePresentation(entry.message).bot : undefined;
  const sender: Peer =
    bot === undefined ? props.ownPeer : { name: bot.name, projectId: bot.projectId };
  const text =
    entry.kind === "sent" ? entry.text : resolveUserMessagePresentation(entry.message).text;
  const streaming = entry.kind === "message" && Boolean(entry.message.streaming);
  return (
    <li className="flex min-w-0 flex-col gap-1">
      <span className="flex items-center gap-1.5 text-muted-foreground text-xs">
        <PeerAvatar peer={sender} />
        <span className="font-medium text-foreground">
          <PeerName peer={sender} />
        </span>
        {entry.kind === "sent" && entry.status !== "sent" ? (
          <span>{entry.status === "sending" ? "Sending…" : "Not delivered"}</span>
        ) : null}
      </span>
      <div className="min-w-0 ps-5.5">
        <ChatMarkdown
          text={text}
          cwd={ctx.markdownCwd}
          threadRef={ctx.threadRef ?? undefined}
          isStreaming={streaming}
          lineBreaks={shouldPreserveAssistantLineBreaks(text)}
          skills={ctx.skills}
          headingLevelOffset={MESSAGE_HEADING_LEVEL}
          onUseArtifactTemplate={ctx.onUseArtifactTemplate}
          onRunShellCommand={ctx.onRunShellCommand}
          onImageExpand={ctx.onImageExpand}
        />
      </div>
    </li>
  );
}

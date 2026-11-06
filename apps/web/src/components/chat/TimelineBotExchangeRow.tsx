import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { resolveUserMessagePresentation } from "@t3tools/client-runtime/user-message";
import type { ProjectId } from "@t3tools/contracts";
import { shouldPreserveAssistantLineBreaks } from "@t3tools/shared/markdownPipeline";
import { ChevronDownIcon } from "lucide-react";
import { use, useState } from "react";

import { cn } from "~/lib/utils";
import { useProject, useThreadShell } from "../../state/entities";
import type { ChatMessage } from "../../types";
import ChatMarkdown from "../ChatMarkdown";
import { BotAvatar } from "../bots/BotAvatar";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible";
import { MESSAGE_HEADING_LEVEL } from "./TimelineRowParts";
import { TimelineRowCtx, type TimelineRow } from "./timelineRowContext";

function joinNames(names: ReadonlyArray<string>): string {
  return names.length <= 1
    ? (names[0] ?? "")
    : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

function ExchangeAvatar(props: { readonly name: string; readonly projectId: ProjectId | null }) {
  const ctx = use(TimelineRowCtx);
  const project = useProject(
    props.projectId === null
      ? null
      : scopeProjectRef(ctx.activeThreadEnvironmentId, props.projectId),
  );
  return (
    <BotAvatar
      avatar={project?.avatar ?? null}
      name={project?.title ?? props.name}
      status="idle"
      size={16}
      className="shrink-0"
    />
  );
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
  const names = joinNames(row.peers.map((peer) => peer.name));
  const count = row.messages.length;

  return (
    <Collapsible open={expanded} onOpenChange={toggle}>
      <div className="flex justify-center">
        <CollapsibleTrigger
          className="flex max-w-full items-center gap-2 rounded-full border border-border/70 px-3 py-1.5 text-muted-foreground text-xs transition-colors hover:text-foreground"
          aria-label={`Talked with ${names}, ${count} ${count === 1 ? "message" : "messages"}`}
        >
          <span className="flex shrink-0 items-center -space-x-1" aria-hidden>
            {row.peers.slice(0, 3).map((peer) => (
              <ExchangeAvatar key={peer.name} name={peer.name} projectId={peer.projectId} />
            ))}
          </span>
          <span className="truncate">
            Talked with <span className="font-medium text-foreground">{names}</span>
          </span>
          <span className="shrink-0 tabular-nums">· {count}</span>
          <ChevronDownIcon
            aria-hidden
            className={cn("size-3.5 shrink-0 transition-transform", expanded && "rotate-180")}
          />
        </CollapsibleTrigger>
      </div>
      <CollapsiblePanel>
        <ol className="mt-2 flex flex-col gap-3 rounded-2xl border border-border/70 p-3">
          {row.messages.map((message) => (
            <ExchangeMessage
              key={message.id}
              message={message}
              ownName={ctx.assistantName}
              ownProjectId={own?.projectId ?? null}
            />
          ))}
        </ol>
      </CollapsiblePanel>
    </Collapsible>
  );
}

function ExchangeMessage(props: {
  readonly message: ChatMessage;
  readonly ownName: string;
  readonly ownProjectId: ProjectId | null;
}) {
  const ctx = use(TimelineRowCtx);
  const presentation = resolveUserMessagePresentation(props.message);
  const sender =
    props.message.role === "assistant" || presentation.bot === undefined
      ? { name: props.ownName, projectId: props.ownProjectId }
      : { name: presentation.bot.name, projectId: presentation.bot.projectId };
  const text = presentation.text;
  return (
    <li className="flex min-w-0 flex-col gap-1">
      <span className="flex items-center gap-1.5 text-muted-foreground text-xs">
        <ExchangeAvatar name={sender.name} projectId={sender.projectId} />
        <span className="font-medium text-foreground">{sender.name}</span>
      </span>
      <div className="min-w-0 ps-5.5">
        <ChatMarkdown
          text={text}
          cwd={ctx.markdownCwd}
          threadRef={ctx.threadRef ?? undefined}
          isStreaming={Boolean(props.message.streaming)}
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

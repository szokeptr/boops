import type { EnvironmentProject } from "@t3tools/client-runtime/state/models";
import { Link } from "@tanstack/react-router";
import { ChevronRightIcon } from "lucide-react";

import { useProjects } from "../../state/entities";
import { Button } from "../ui/button";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible";
import { BotAvatar } from "./BotAvatar";
import { useBotArchive, useCanManageBot } from "./BotLifecycle";

/** Archived bots, collapsed under the bot list, each with Unarchive. */
export function ArchivedBotList() {
  const archived = useProjects()
    .filter((project) => project.archivedAt != null && !project.isScratch)
    .toSorted((a, b) => a.title.localeCompare(b.title));
  if (archived.length === 0) return null;
  return (
    <Collapsible className="mt-2">
      <CollapsibleTrigger className="flex h-7 w-full items-center gap-1 rounded-md px-2 text-xs text-sidebar-muted-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground data-panel-open:[&_svg]:rotate-90">
        <ChevronRightIcon aria-hidden className="size-3 transition-transform" />
        Archived ({archived.length})
      </CollapsibleTrigger>
      <CollapsiblePanel>
        <ul aria-label="Archived bots" className="flex flex-col gap-px pt-1">
          {archived.map((project) => (
            <ArchivedBotRow key={`${project.environmentId}:${project.id}`} project={project} />
          ))}
        </ul>
      </CollapsiblePanel>
    </Collapsible>
  );
}

function ArchivedBotRow({ project }: { readonly project: EnvironmentProject }) {
  const canManage = useCanManageBot(project.environmentId);
  const { unarchiveBot } = useBotArchive();
  const content = (
    <>
      <BotAvatar avatar={project.avatar ?? null} name={project.title} size={16} status="dozing" />
      <span className="min-w-0 flex-1 truncate">{project.title}</span>
    </>
  );
  const rowClass =
    "flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1 text-sm text-sidebar-muted-foreground";
  return (
    <li className="flex list-none items-center gap-1">
      {project.mainThreadId ? (
        <Link
          to="/$environmentId/$threadId"
          params={{ environmentId: project.environmentId, threadId: project.mainThreadId }}
          className={`${rowClass} hover:bg-sidebar-row-hover hover:text-sidebar-foreground`}
        >
          {content}
        </Link>
      ) : (
        <span className={rowClass}>{content}</span>
      )}
      {canManage ? (
        <Button
          size="xs"
          variant="ghost-muted"
          aria-label={`Unarchive ${project.title}`}
          onClick={() =>
            void unarchiveBot({
              environmentId: project.environmentId,
              projectId: project.id,
              name: project.title,
            })
          }
        >
          Unarchive
        </Button>
      ) : null}
    </li>
  );
}

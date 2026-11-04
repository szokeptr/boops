import { createFileRoute } from "@tanstack/react-router";
import { PlusIcon } from "lucide-react";

import { BotListPanel, openAddBot } from "../components/bots/BotSidebar";
import { HostedEmptyState } from "../components/HostedEmptyState";
import { Button } from "../components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../components/ui/empty";
import { SidebarInset, useSidebar } from "../components/ui/sidebar";
import { WorkspacePageHeader } from "../components/WorkspacePageHeader";
import { isElectron } from "../env";
import { useBotRows } from "../hooks/useBotRows";
import { workspaceAreaProps } from "../lib/workspaceFocus";
import { useAllEnvironmentShellsBootstrapped } from "../state/entities";
import { useEnvironments } from "../state/environments";

function ChatIndexRouteView() {
  const { authGateState } = Route.useRouteContext();
  const { environments, isReady } = useEnvironments();

  if (authGateState.status === "hosted-static") {
    if (!isReady) return null;
    if (environments.length === 0) return <HostedEmptyState />;
  }

  return <BotHome />;
}

/** Narrow layouts have no room for the sidebar beside a chat, so the bot list is the home screen. */
function BotHome() {
  const { isMobile } = useSidebar();
  const hasBots = useBotRows().length > 0;
  // A pending environment cannot prove there are no bots.
  const bootstrapped = useAllEnvironmentShellsBootstrapped();
  const contentArea = workspaceAreaProps("home", 1, "Home");
  return (
    <SidebarInset
      {...contentArea}
      role="main"
      className="h-dvh min-h-0 overflow-hidden overscroll-y-none"
    >
      <WorkspacePageHeader electron={isElectron}>
        {isMobile ? <h1 className="text-sm font-medium">Bots</h1> : null}
      </WorkspacePageHeader>
      {isMobile && hasBots ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          <BotListPanel />
        </div>
      ) : hasBots || bootstrapped ? (
        <Empty className="flex-1">
          <EmptyHeader>
            <EmptyTitle>{hasBots ? "Pick a bot" : "No bots yet"}</EmptyTitle>
            <EmptyDescription>
              {hasBots
                ? "Choose a bot from the list to continue its conversation."
                : "Add a bot to start talking to it from any of your devices."}
            </EmptyDescription>
            {hasBots ? null : (
              <div className="mt-5 flex justify-center">
                <Button size="sm" onClick={openAddBot}>
                  <PlusIcon className="size-4" />
                  Add bot
                </Button>
              </div>
            )}
          </EmptyHeader>
        </Empty>
      ) : null}
    </SidebarInset>
  );
}

export const Route = createFileRoute("/_chat/")({
  component: ChatIndexRouteView,
});

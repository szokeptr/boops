import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { createFileRoute } from "@tanstack/react-router";

import { BotActivityPage } from "../components/bots/BotActivity";

function BotActivityRouteView() {
  const { environmentId, projectId } = Route.useParams();
  return (
    <BotActivityPage
      environmentId={environmentId as EnvironmentId}
      projectId={projectId as ProjectId}
    />
  );
}

export const Route = createFileRoute("/_chat/bots/$environmentId/$projectId/activity")({
  component: BotActivityRouteView,
});

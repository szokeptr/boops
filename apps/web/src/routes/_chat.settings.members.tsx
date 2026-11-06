import { createFileRoute } from "@tanstack/react-router";

import { MembersSettingsPanel } from "../components/settings/MembersSettings";

export const Route = createFileRoute("/_chat/settings/members")({
  component: MembersSettingsPanel,
});

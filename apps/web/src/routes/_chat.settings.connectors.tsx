import { createFileRoute } from "@tanstack/react-router";

import { ConnectorsSettingsPanel } from "../components/settings/ConnectorsSettings";

export const Route = createFileRoute("/_chat/settings/connectors")({
  component: ConnectorsSettingsPanel,
});

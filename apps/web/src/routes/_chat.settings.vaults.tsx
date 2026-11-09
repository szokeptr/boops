import { createFileRoute } from "@tanstack/react-router";

import { VaultsSettingsPanel } from "../components/settings/VaultsSettings";

export const Route = createFileRoute("/_chat/settings/vaults")({
  component: VaultsSettingsPanel,
});

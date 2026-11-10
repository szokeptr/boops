import { useAtomValue } from "@effect/atom-react";
import { createSidebarLayoutEnvironmentAtoms } from "@t3tools/client-runtime/state/sidebar-sections";
import { EMPTY_SIDEBAR_LAYOUT, type SidebarLayout } from "@t3tools/contracts";

import { connectionAtomRuntime } from "../connection/runtime";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { useEnvironments } from "./environments";
import { useAtomCommand } from "./use-atom-command";

const sidebarLayoutEnvironment = createSidebarLayoutEnvironmentAtoms(connectionAtomRuntime);

/** The viewer's sidebar sections, and a way to change them on every client they use. */
export function useSidebarLayout() {
  const { environments } = useEnvironments();
  const home = useAtomValue(
    sidebarLayoutEnvironment.home(
      environments.map((environment) => environment.environmentId).join("\n"),
    ),
  );
  const pending = useAtomValue(sidebarLayoutEnvironment.pending);
  const server = home?.layout ?? null;
  const layout =
    pending !== null && pending.base === server ? pending.layout : (server ?? EMPTY_SIDEBAR_LAYOUT);
  const runSet = useAtomCommand(sidebarLayoutEnvironment.set, "Could not save the sidebar");
  const update = (change: (layout: SidebarLayout) => SidebarLayout) => {
    if (home === null || server === null) return;
    const next = change(layout);
    appAtomRegistry.set(sidebarLayoutEnvironment.pending, { layout: next, base: server });
    void runSet({ environmentId: home.environmentId, input: { layout: next } }).then((result) => {
      if (result._tag === "Failure") appAtomRegistry.set(sidebarLayoutEnvironment.pending, null);
    });
  };
  return { layout, loaded: server !== null, update };
}

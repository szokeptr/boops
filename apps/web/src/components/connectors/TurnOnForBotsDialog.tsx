import type { ConnectorConnection, EnvironmentId } from "@t3tools/contracts";

import { useEnvironmentBots } from "../../state/connectors";
import { ProjectFavicon } from "../ProjectFavicon";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Switch } from "../ui/switch";
import { useSetBotConnection } from "./useSetBotConnection";

/** Right after a connection is made: which bots get it. Each switch saves at once. */
export function TurnOnForBotsDialog(props: {
  readonly environmentId: EnvironmentId;
  readonly connection: ConnectorConnection;
  readonly onClose: () => void;
}) {
  const bots = useEnvironmentBots(props.environmentId);
  const { allowed, set } = useSetBotConnection(props.environmentId);
  const { connection } = props;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <DialogPopup className="max-w-md">
        <DialogHeader>
          <DialogTitle>{connection.displayName} is connected</DialogTitle>
          <DialogDescription>
            Turn it on for the bots that should use it. They get its tools from their next turn.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          {bots.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No bots yet. Turn it on from a bot's settings once you have one.
            </p>
          ) : (
            <ul className="grid gap-1" aria-label="Bots">
              {bots.map((bot) => {
                const on = bot.connectionIds?.includes(connection.id) === true;
                return (
                  <li key={bot.id} className="flex items-center gap-2.5 py-1.5">
                    <ProjectFavicon project={bot} className="size-5" />
                    <span className="min-w-0 flex-1 truncate text-sm">{bot.title}</span>
                    <Switch
                      checked={on}
                      disabled={!allowed}
                      aria-label={`Turn ${connection.displayName} on for ${bot.title}`}
                      onCheckedChange={(checked) =>
                        void set({
                          projectId: bot.id,
                          connectionId: connection.id,
                          enabled: checked,
                        })
                      }
                    />
                  </li>
                );
              })}
            </ul>
          )}
        </DialogPanel>
        <DialogFooter variant="bare">
          <Button onClick={props.onClose}>Done</Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type { ThreadId } from "@t3tools/contracts";
import { PhoneIcon } from "lucide-react";

import { setBotCallMinimized, startBotCall, useActiveBotCall } from "../../state/botCall";
import { projectEnvironment } from "../../state/projects";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

/** Starts a voice call with the bot in this conversation, or shows the one already going. */
export function BotCallButton({
  bot,
  threadId,
}: {
  readonly bot: EnvironmentProject;
  readonly threadId: ThreadId;
}) {
  const canCall = useAtomValue(projectEnvironment.startBotCall.permissionAtom(bot.environmentId));
  const call = useActiveBotCall();
  const inThisCall =
    call !== null &&
    call.target.environmentId === bot.environmentId &&
    call.target.projectId === bot.id &&
    (call.state.phase === "connecting" || call.state.phase === "live");
  if (!canCall) return null;
  const label = inThisCall ? `Show call with ${bot.title}` : `Call ${bot.title}`;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={label}
            className="shrink-0"
            onClick={() =>
              inThisCall
                ? setBotCallMinimized(false)
                : startBotCall({
                    environmentId: bot.environmentId,
                    projectId: bot.id,
                    threadId,
                    name: bot.title,
                    avatar: bot.avatar ?? null,
                  })
            }
          />
        }
      >
        <PhoneIcon />
      </TooltipTrigger>
      <TooltipPopup side="bottom">{label}</TooltipPopup>
    </Tooltip>
  );
}

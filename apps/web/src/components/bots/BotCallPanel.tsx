import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { useNavigate } from "@tanstack/react-router";
import { MicIcon, MicOffIcon, Minimize2Icon, PhoneOffIcon } from "lucide-react";

import { useNowSecond } from "~/hooks/useNowSecond";
import { cn } from "~/lib/utils";
import {
  type ActiveBotCall,
  dismissBotCall,
  hangUpBotCall,
  setBotCallMinimized,
  setBotCallMuted,
  startBotCall,
  useActiveBotCall,
} from "../../state/botCall";
import { useThreadShell } from "../../state/entities";
import { searchableSetting } from "../settings/settingsSearch";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { BotAvatar } from "./BotAvatar";

function formatCallDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = String(seconds % 60).padStart(2, "0");
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}` : `${minutes}:${rest}`;
}

/** The app-wide call: floats above every page so the conversation stays in view while talking. */
export function BotCallHost() {
  const call = useActiveBotCall();
  if (call === null) return null;
  return <BotCallPanel key={call.key} call={call} />;
}

function CallTimer({ connectedAt }: { readonly connectedAt: number }) {
  const now = useNowSecond();
  return <>{formatCallDuration((now - connectedAt) / 1000)}</>;
}

function BotCallPanel({ call }: { readonly call: ActiveBotCall }) {
  const { state, target } = call;
  const shell = useThreadShell(scopeThreadRef(target.environmentId, target.threadId));
  const working = state.phase === "live" && (shell?.runtime?.activeRunId ?? null) !== null;
  const live = state.phase === "live" && state.connectedAt !== null;

  if (call.minimized) {
    return (
      <button
        type="button"
        aria-label={`Call with ${target.name}. Show call`}
        onClick={() => setBotCallMinimized(false)}
        className="fixed top-14 right-4 z-50 flex items-center gap-2 rounded-full border border-border/70 bg-popover py-1 ps-1 pe-3 text-sm shadow-lg outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      >
        <BotAvatar
          avatar={target.avatar}
          name={target.name}
          status={working ? "working" : "idle"}
          size={28}
        />
        <span className="font-medium tabular-nums">
          {live && state.connectedAt !== null ? (
            <CallTimer connectedAt={state.connectedAt} />
          ) : state.phase === "connecting" ? (
            "Calling…"
          ) : (
            "Call ended"
          )}
        </span>
        <SpeakingDot speaker={state.speaker} />
      </button>
    );
  }

  return (
    <section
      aria-label={`Call with ${target.name}`}
      className="fixed top-14 right-4 z-50 w-[min(20rem,calc(100vw-2rem))] rounded-2xl border border-border/70 bg-popover p-4 text-popover-foreground shadow-xl"
    >
      <div className="absolute end-2 top-2">
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost-muted"
                size="icon-xs"
                aria-label="Minimize call"
                onClick={() => setBotCallMinimized(true)}
              />
            }
          >
            <Minimize2Icon />
          </TooltipTrigger>
          <TooltipPopup side="top">Minimize</TooltipPopup>
        </Tooltip>
      </div>

      <div className="flex flex-col items-center gap-3 pt-2 text-center">
        {/* A soft halo while the bot talks; state-driven, so nothing repaints between changes. */}
        <div
          data-speaking={state.speaker === "bot" ? "" : undefined}
          className="rounded-full ring-0 ring-primary/25 motion-safe:transition-[box-shadow] motion-safe:duration-300 data-speaking:ring-8"
        >
          <BotAvatar
            avatar={target.avatar}
            name={target.name}
            status={working ? "working" : "idle"}
            size={72}
          />
        </div>
        <div className="min-w-0">
          <p className="truncate font-medium">{target.name}</p>
          <p className="text-xs text-muted-foreground tabular-nums" aria-live="polite">
            <CallStatus call={call} working={working} />
          </p>
        </div>
      </div>

      {state.phase === "failed" ? (
        <CallFailure call={call} />
      ) : (
        <>
          <p
            aria-live="polite"
            className={cn(
              "mt-3 line-clamp-3 min-h-10 text-center text-sm motion-safe:transition-opacity motion-safe:duration-200",
              state.caption === null && "opacity-0",
              state.caption?.speaker === "user"
                ? "text-muted-foreground italic"
                : "text-foreground",
            )}
          >
            {state.caption?.text ?? " "}
          </p>
          <div className="mt-4 flex items-center justify-center gap-4">
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant={state.muted ? "secondary" : "outline"}
                    size="icon-xl"
                    aria-pressed={state.muted}
                    aria-label={state.muted ? "Unmute" : "Mute"}
                    disabled={state.phase !== "live" && state.phase !== "connecting"}
                    onClick={() => setBotCallMuted(!state.muted)}
                  />
                }
              >
                {state.muted ? <MicOffIcon /> : <MicIcon />}
              </TooltipTrigger>
              <TooltipPopup side="top">{state.muted ? "Unmute" : "Mute"}</TooltipPopup>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="destructive"
                    size="icon-xl"
                    aria-label="Hang up"
                    disabled={state.phase === "ended" || state.phase === "ending"}
                    onClick={hangUpBotCall}
                  />
                }
              >
                <PhoneOffIcon />
              </TooltipTrigger>
              <TooltipPopup side="top">Hang up</TooltipPopup>
            </Tooltip>
          </div>
        </>
      )}
    </section>
  );
}

function CallStatus({
  call,
  working,
}: {
  readonly call: ActiveBotCall;
  readonly working: boolean;
}) {
  const { state } = call;
  switch (state.phase) {
    case "connecting":
      return <>Calling…</>;
    case "ending":
    case "ended":
      return <>Call ended</>;
    case "failed":
      return <>Call failed</>;
    case "live": {
      const detail = state.muted
        ? "Muted"
        : working
          ? "Working on it…"
          : state.speaker === "user"
            ? "Listening"
            : null;
      return (
        <>
          {state.connectedAt !== null ? <CallTimer connectedAt={state.connectedAt} /> : null}
          {detail !== null ? ` · ${detail}` : null}
        </>
      );
    }
  }
}

function CallFailure({ call }: { readonly call: ActiveBotCall }) {
  const navigate = useNavigate();
  const error = call.state.error;
  return (
    <div className="mt-3 flex flex-col items-center gap-3 text-center">
      <p className="text-sm text-muted-foreground">{error?.message ?? "The call failed."}</p>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={dismissBotCall}>
          Close
        </Button>
        {error?.reason === "not-configured" ? (
          <Button
            size="sm"
            onClick={() => {
              dismissBotCall();
              void navigate({
                to: "/settings/providers",
                hash: searchableSetting("voice-calls").id,
                state: { settingsTargetHighlight: true },
              });
            }}
          >
            Add API key
          </Button>
        ) : (
          <Button size="sm" onClick={() => startBotCall(call.target)}>
            Call again
          </Button>
        )}
      </div>
    </div>
  );
}

function SpeakingDot({ speaker }: { readonly speaker: ActiveBotCall["state"]["speaker"] }) {
  return (
    <span
      aria-hidden
      className={cn(
        "size-2 rounded-full motion-safe:transition-colors motion-safe:duration-200",
        speaker === "bot"
          ? "bg-primary"
          : speaker === "user"
            ? "bg-success"
            : "bg-muted-foreground/30",
      )}
    />
  );
}

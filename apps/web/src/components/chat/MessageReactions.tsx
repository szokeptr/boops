import {
  type MessageId,
  type OrchestrationV2MessageReaction,
  setMessageReaction,
} from "@t3tools/contracts";
import {
  firstEmoji,
  groupMessageReactions,
  MESSAGE_QUICK_REACTIONS,
  type MessageReactionGroup,
  messageReactionLabel,
  MORE_REACTION_EMOJIS,
  myMessageReaction,
  toggledMessageReaction,
} from "@t3tools/client-runtime/message-reactions";
import { CopyIcon, PencilIcon, SmilePlusIcon } from "lucide-react";
import { type CSSProperties, type MouseEvent, use, useState } from "react";
import type { PopoverRootChangeEventDetails } from "@base-ui/react/popover";
import { cn } from "~/lib/utils";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { showAnchoredCopyErrorToast, showAnchoredCopySuccessToast } from "../ui/anchoredCopyToast";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Popover, PopoverPopup } from "../ui/popover";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { TimelineRowCtx } from "./timelineRowContext";

/** Marks the bar, its action menu and the trigger, so a press on one does not close the others. */
const SURFACE_ATTRIBUTE = "data-message-reaction-surface";

// The bar and its actions sit on opposite sides of the bubble; a flip would stack one on the other.
const KEEP_SIDE = { side: "shift", align: "shift" } as const;
// With the grid open the actions menu hides, so the picker may flip below a bubble at the top.
const FLIP_SIDE = { side: "flip", align: "shift" } as const;
// Room the bar, and the bar with the emoji grid, take above a bubble.
const BAR_ROOM_PX = 64;
const PICKER_ROOM_PX = 280;

/** The bar opens above the bubble and never flips, so scroll a tall bubble down to fit it. */
function makeRoomAbove(anchor: HTMLElement | null, room: number) {
  let scroller = anchor?.parentElement ?? null;
  while (scroller !== null && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) {
    scroller = scroller.parentElement;
  }
  if (anchor === null || scroller === null) return;
  const gap = anchor.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
  if (gap < room) scroller.scrollBy({ top: gap - room });
}

interface PendingReaction {
  /** The server's reactions when this was chosen; any change from the server replaces it. */
  readonly base: ReadonlyArray<OrchestrationV2MessageReaction> | undefined;
  readonly emoji: string | null;
  readonly at: string;
}

export interface MessageReactionController {
  readonly groups: ReadonlyArray<MessageReactionGroup>;
  readonly mine: string | null;
  /** False in a guest view or while the message streams: badges show, the bar does not. */
  readonly interactive: boolean;
  readonly open: boolean;
  /** The bubble, which the bar and its actions are placed against. */
  readonly anchor: HTMLElement | null;
  readonly setAnchor: (element: HTMLElement | null) => void;
  readonly trigger: HTMLButtonElement | null;
  readonly setTrigger: (element: HTMLButtonElement | null) => void;
  readonly setOpen: (open: boolean) => void;
  readonly choose: (emoji: string) => void;
  readonly onContextMenu: (event: MouseEvent<HTMLElement>) => void;
}

/** A bubble's reactions, with your choice shown before the server confirms it. */
export function useMessageReactions(input: {
  readonly messageId: MessageId;
  readonly reactions: ReadonlyArray<OrchestrationV2MessageReaction> | undefined;
  readonly streaming: boolean;
}): MessageReactionController {
  const ctx = use(TimelineRowCtx);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [trigger, setTrigger] = useState<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<PendingReaction | null>(null);
  const onReact = ctx.onReactToMessage;
  const interactive = ctx.directMessage && onReact !== undefined && !input.streaming;
  const reactions =
    pending !== null && pending.base === input.reactions
      ? setMessageReaction(input.reactions ?? [], { kind: "user" }, pending.emoji, pending.at)
      : input.reactions;
  const mine = myMessageReaction(reactions);
  const choose = (emoji: string) => {
    setOpen(false);
    if (onReact === undefined) return;
    const next = toggledMessageReaction(mine, emoji);
    const chosen = { base: input.reactions, emoji: next, at: new Date().toISOString() };
    setPending(chosen);
    void onReact(input.messageId, next).then((ok) => {
      if (!ok) setPending((current) => (current === chosen ? null : current));
    });
  };
  const openBar = (next: boolean) => {
    if (next) makeRoomAbove(anchor, BAR_ROOM_PX);
    setOpen(next);
  };
  const onContextMenu = (event: MouseEvent<HTMLElement>) => {
    if (!interactive || event.defaultPrevented) return;
    // Selected text keeps the browser's menu, so Copy and Look Up still work on it.
    const selection = window.getSelection();
    if (
      selection !== null &&
      !selection.isCollapsed &&
      event.currentTarget.contains(selection.anchorNode)
    ) {
      return;
    }
    event.preventDefault();
    openBar(true);
  };
  return {
    groups: groupMessageReactions(reactions),
    mine,
    interactive,
    open: open && interactive,
    anchor,
    setAnchor,
    trigger,
    setTrigger,
    setOpen: openBar,
    choose,
    onContextMenu,
  };
}

function pressedInsideSurface(details: PopoverRootChangeEventDetails): boolean {
  const event = details.event;
  const target = event instanceof FocusEvent ? event.relatedTarget : event?.target;
  return target instanceof Element && target.closest(`[${SURFACE_ATTRIBUTE}]`) !== null;
}

/** Shows the reaction bar from beside a bubble; it appears while the row is hovered. */
export function MessageReactionTrigger({
  controller,
}: {
  readonly controller: MessageReactionController;
}) {
  const { setTrigger } = controller;
  if (!controller.interactive) return null;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            ref={setTrigger}
            type="button"
            size="icon-xs"
            variant="ghost-muted"
            aria-label="React"
            aria-haspopup="dialog"
            aria-expanded={controller.open}
            {...{ [SURFACE_ATTRIBUTE]: "" }}
            onClick={() => controller.setOpen(!controller.open)}
          />
        }
      >
        <SmilePlusIcon className="size-3.5" />
      </TooltipTrigger>
      <TooltipPopup side="top">React</TooltipPopup>
    </Tooltip>
  );
}

const NEUTRAL_BADGE_FILL = "bg-message-reaction text-foreground";

/** The bubble class that leaves room above for the badges, so they clear the row before. */
export const MESSAGE_REACTION_BUBBLE_CLEARANCE = "mt-4.5";

/**
 * The reactions pinned over a bubble's top corner as tapbacks: `end` for the bot's bubbles on the
 * left, `start` for yours on the right. Each emoji is a small bubble; they overlap toward the
 * corner with the newest in front, and that one carries the tail. The bubble must be positioned.
 */
export function MessageReactionBadges({
  controller,
  corner,
}: {
  readonly controller: MessageReactionController;
  readonly corner: "start" | "end";
}) {
  const ctx = use(TimelineRowCtx);
  const emojis = controller.groups.map((group) => group.emoji);
  // Badges present when the row mounted stay still; only one added afterwards pops in.
  const [settled, setSettled] = useState<ReadonlySet<string>>(() => new Set(emojis));
  if ([...settled].some((emoji) => !emojis.includes(emoji))) {
    setSettled(new Set(emojis.filter((emoji) => settled.has(emoji))));
  }
  if (controller.groups.length === 0) return null;
  const ownColors = ctx.ownBubbleColors;
  const outer = corner === "end" ? "end" : "start";
  return (
    <div
      className={cn(
        "absolute -top-4 z-10 flex items-center drop-shadow-sm",
        corner === "end" ? "-end-3" : "-start-3 flex-row-reverse",
      )}
      data-message-reactions=""
    >
      {controller.groups.map((group, index) => {
        const label = messageReactionLabel(group);
        const front = index === controller.groups.length - 1;
        const fill = group.mine
          ? ownColors === null
            ? "bg-primary text-primary-foreground"
            : undefined
          : NEUTRAL_BADGE_FILL;
        const fillStyle: CSSProperties | undefined =
          group.mine && ownColors !== null
            ? { backgroundColor: ownColors.background, color: ownColors.foreground }
            : undefined;
        const pill = cn(
          "relative flex h-6.5 min-w-6.5 items-center justify-center gap-0.5 rounded-full px-1.5 text-sm leading-none ring-2 ring-background",
          fill,
        );
        const content = (
          <>
            <span aria-hidden>{group.emoji}</span>
            {group.count > 1 ? (
              <span aria-hidden className="pe-0.5 text-2xs font-medium tabular-nums">
                {group.count}
              </span>
            ) : null}
          </>
        );
        return (
          <div
            key={group.emoji}
            className={cn(
              "relative isolate",
              index > 0 && (outer === "end" ? "-ms-1" : "-me-1"),
              outer === "end" ? "origin-bottom-right" : "origin-bottom-left",
              !settled.has(group.emoji) && "motion-safe:animate-reaction-pop",
            )}
            style={{ zIndex: index }}
            data-message-reaction-mine={group.mine ? "" : undefined}
          >
            {front ? <ReactionTail side={outer} layer="outline" /> : null}
            <Tooltip>
              <TooltipTrigger
                render={
                  controller.interactive ? (
                    <button
                      type="button"
                      aria-label={group.mine ? `${label}. Remove your reaction` : label}
                      aria-pressed={group.mine}
                      {...{ [SURFACE_ATTRIBUTE]: "" }}
                      className={cn(
                        pill,
                        "cursor-pointer focus-visible:outline-2 focus-visible:outline-ring",
                      )}
                      style={fillStyle}
                      onClick={() =>
                        group.mine ? controller.choose(group.emoji) : controller.setOpen(true)
                      }
                    />
                  ) : (
                    <span role="img" aria-label={label} className={pill} style={fillStyle} />
                  )
                }
              >
                {content}
              </TooltipTrigger>
              <TooltipPopup side="top">{label}</TooltipPopup>
            </Tooltip>
            {front ? (
              <ReactionTail side={outer} layer="fill" className={fill} style={fillStyle} />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

/**
 * A tapback's tail: two dots trailing off its outer bottom corner. The outline layer goes under
 * the badge and the fill layer over it, so badge and tail share one outline.
 */
function ReactionTail({
  side,
  layer,
  className,
  style,
}: {
  readonly side: "start" | "end";
  readonly layer: "outline" | "fill";
  readonly className?: string | undefined;
  readonly style?: CSSProperties | undefined;
}) {
  const dot = cn(
    "pointer-events-none absolute rounded-full",
    layer === "outline" ? "bg-background ring-2 ring-background" : className,
  );
  return (
    <>
      <span
        aria-hidden
        className={cn(dot, "-bottom-0.5 size-2.25", side === "end" ? "-end-0.5" : "-start-0.5")}
        style={style}
      />
      <span
        aria-hidden
        className={cn(dot, "-bottom-1.5 size-1", side === "end" ? "-end-1.5" : "-start-1.5")}
        style={style}
      />
    </>
  );
}

/**
 * The bar of reactions above a bubble and its actions below, open together. `align` lines both
 * up with the bubble's side of the timeline.
 */
export function MessageReactionMenu({
  controller,
  align,
  copyText,
  onEdit,
}: {
  readonly controller: MessageReactionController;
  readonly align: "start" | "end";
  readonly copyText: string;
  readonly onEdit?: (() => void) | undefined;
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [wasOpen, setWasOpen] = useState(controller.open);
  if (wasOpen !== controller.open) {
    setWasOpen(controller.open);
    setMoreOpen(false);
    setTyped("");
  }
  const { copyToClipboard } = useCopyToClipboard<void>({
    onCopy: () => showAnchoredCopySuccessToast({ current: controller.trigger }),
    onError: (error: Error) => showAnchoredCopyErrorToast({ current: controller.trigger }, error),
  });
  if (!controller.interactive) return null;
  const onOpenChange = (open: boolean, details: PopoverRootChangeEventDetails) => {
    if (
      !open &&
      (details.reason === "outside-press" || details.reason === "focus-out") &&
      pressedInsideSurface(details)
    ) {
      return;
    }
    controller.setOpen(open);
  };
  const surface = { [SURFACE_ATTRIBUTE]: "" };
  return (
    <>
      <Popover open={controller.open} onOpenChange={onOpenChange}>
        <PopoverPopup
          anchor={controller.anchor}
          side="top"
          align={align}
          sideOffset={10}
          collisionAvoidance={moreOpen ? FLIP_SIDE : KEEP_SIDE}
          padding="none"
          aria-label="React to message"
          {...surface}
        >
          <div className="flex flex-col gap-1 p-1">
            <div className="flex items-center gap-0.5">
              {MESSAGE_QUICK_REACTIONS.map((emoji) => (
                <ReactionChoice
                  key={emoji}
                  emoji={emoji}
                  current={controller.mine === emoji}
                  onChoose={controller.choose}
                />
              ))}
              <Button
                type="button"
                size="icon-sm"
                variant="ghost-muted"
                aria-label="More reactions"
                aria-expanded={moreOpen}
                onClick={() => {
                  if (!moreOpen) makeRoomAbove(controller.anchor, PICKER_ROOM_PX);
                  setMoreOpen(!moreOpen);
                }}
              >
                <SmilePlusIcon />
              </Button>
            </div>
            {moreOpen ? (
              <div className="flex w-72 max-w-full flex-col gap-1 px-0.5 pb-0.5">
                <Input
                  size="sm"
                  autoFocus
                  value={typed}
                  placeholder="Type or paste any emoji"
                  aria-label="Any emoji"
                  onChange={(event) => {
                    const emoji = firstEmoji(event.currentTarget.value);
                    if (emoji === null) {
                      setTyped(event.currentTarget.value);
                      return;
                    }
                    controller.choose(emoji);
                  }}
                />
                <div
                  role="group"
                  aria-label="More reactions"
                  className="grid max-h-40 grid-cols-8 gap-0.5 overflow-y-auto"
                >
                  {MORE_REACTION_EMOJIS.map((emoji) => (
                    <ReactionChoice
                      key={emoji}
                      emoji={emoji}
                      current={controller.mine === emoji}
                      onChoose={controller.choose}
                    />
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </PopoverPopup>
      </Popover>
      {copyText || onEdit ? (
        <Popover open={controller.open && !moreOpen} onOpenChange={onOpenChange}>
          <PopoverPopup
            anchor={controller.anchor}
            side="bottom"
            align={align}
            sideOffset={6}
            collisionAvoidance={KEEP_SIDE}
            padding="none"
            initialFocus={false}
            finalFocus={false}
            aria-label="Message actions"
            {...surface}
          >
            <div className="flex flex-col p-1">
              {copyText ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    copyToClipboard(copyText);
                    controller.setOpen(false);
                  }}
                >
                  <CopyIcon />
                  Copy
                </Button>
              ) : null}
              {onEdit ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    controller.setOpen(false);
                    onEdit();
                  }}
                >
                  <PencilIcon />
                  Edit
                </Button>
              ) : null}
            </div>
          </PopoverPopup>
        </Popover>
      ) : null}
    </>
  );
}

function ReactionChoice({
  emoji,
  current,
  onChoose,
}: {
  readonly emoji: string;
  readonly current: boolean;
  readonly onChoose: (emoji: string) => void;
}) {
  return (
    <Button
      type="button"
      size="icon-sm"
      variant="ghost"
      aria-label={current ? `Remove ${emoji} reaction` : `React with ${emoji}`}
      aria-pressed={current}
      data-pressed={current ? "" : undefined}
      onClick={() => onChoose(emoji)}
    >
      <span aria-hidden className="text-lg leading-none">
        {emoji}
      </span>
    </Button>
  );
}

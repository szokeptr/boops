import { useAtomValue } from "@effect/atom-react";
import {
  type EnvironmentId,
  EnvironmentMemberId,
  type ProjectId,
  type RoomId,
  type RoomParticipant,
  roomParticipantKey,
  type RoomPerson,
  type RoomSummary,
} from "@t3tools/contracts";
import { Link, useNavigate } from "@tanstack/react-router";
import { BellOffIcon, EllipsisIcon } from "lucide-react";

import { useProjects } from "../../state/entities";
import { memberEnvironment } from "../../state/members";
import { useEnvironmentPresentation } from "../../state/presentation";
import { useRoom, useRoomBotLooks } from "../../state/rooms";
import { Button } from "../ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
  MenuTrigger,
} from "../ui/menu";
import { openRenameRoomDialog } from "./RenameRoomDialog";
import { RoomAvatar } from "./RoomAvatar";
import { RoomComposer } from "./RoomComposer";
import { RoomRequests } from "./RoomRequests";
import { type RoomBot, RoomTimeline } from "./RoomTimeline";
import { useRoomCommands } from "./useRoomCommands";

function RoomNotice({ children }: { readonly children?: string }) {
  return (
    <div className="flex flex-1 items-center justify-center p-6 text-center text-muted-foreground text-sm">
      {children}
    </div>
  );
}

export function RoomPage(props: {
  readonly environmentId: EnvironmentId;
  readonly roomId: RoomId;
}) {
  const { loaded, room, people } = useRoom(props.environmentId, props.roomId);
  const { presentation } = useEnvironmentPresentation(props.environmentId);
  if (!loaded) {
    // Still connecting shows nothing yet, as a thread does while it loads.
    return presentation === null || presentation.connection.phase === "connected" ? (
      <RoomNotice />
    ) : (
      <RoomNotice>
        {`Can't reach ${presentation.entry.target.label} right now. This group chat opens when it reconnects.`}
      </RoomNotice>
    );
  }
  if (room === null || !room.joined) {
    return (
      <Empty className="flex-1">
        <EmptyHeader>
          <EmptyTitle>This group chat is gone</EmptyTitle>
          <EmptyDescription>It was deleted, or you are no longer in it.</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button render={<Link to="/" />} size="sm" variant="outline">
            Go back
          </Button>
        </EmptyContent>
      </Empty>
    );
  }
  // Keyed so paging, the caret and menus start fresh in each room.
  return (
    <RoomView
      key={`${props.environmentId}:${room.id}`}
      environmentId={props.environmentId}
      room={room}
      people={people}
    />
  );
}

function RoomView({
  environmentId,
  room,
  people,
}: {
  environmentId: EnvironmentId;
  room: RoomSummary;
  people: ReadonlyArray<RoomPerson>;
}) {
  const sessionMember = useAtomValue(memberEnvironment.sessionMemberAtom(environmentId));
  const me: RoomParticipant =
    sessionMember === null
      ? { kind: "owner" }
      : { kind: "member", memberId: EnvironmentMemberId.make(sessionMember.id) };
  const myKey = roomParticipantKey(me);
  const botEntries = room.participants.flatMap((entry) =>
    entry.participant.kind === "bot"
      ? [{ projectId: entry.participant.projectId, name: entry.name }]
      : [],
  );
  const looks = useRoomBotLooks(
    environmentId,
    botEntries.map((entry) => entry.projectId),
  );
  const bots: ReadonlyArray<RoomBot> = botEntries.map((entry, index) => ({
    ...entry,
    avatar: looks[index]?.avatar ?? null,
    threadId: looks[index]?.threadId ?? null,
  }));
  const working = bots.filter((bot) => room.working.includes(bot.projectId));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <RoomHeader environmentId={environmentId} room={room} me={me} people={people} />
      <RoomTimeline
        environmentId={environmentId}
        roomId={room.id}
        bots={bots}
        myKey={myKey}
        working={working}
      />
      <div className="chat-composer-lane w-full shrink-0 px-4 pb-4">
        <RoomRequests environmentId={environmentId} roomId={room.id} bots={bots} />
        {room.archivedAt === null ? (
          <RoomComposer
            environmentId={environmentId}
            roomId={room.id}
            roomTitle={room.title}
            bots={bots}
            working={working}
          />
        ) : (
          <p className="mx-auto max-w-(--chat-content-max-width) py-3 text-center text-muted-foreground text-sm">
            This group chat is archived.
          </p>
        )}
      </div>
    </div>
  );
}

/** Bots the viewer may bring in: on a member's session, only those shared with them. */
function AddBotItems(props: {
  readonly environmentId: EnvironmentId;
  readonly inRoom: ReadonlySet<string>;
  readonly onAdd: (projectId: ProjectId) => void;
}) {
  const addable = useProjects().filter(
    (project) =>
      project.environmentId === props.environmentId &&
      !project.isScratch &&
      !props.inRoom.has(roomParticipantKey({ kind: "bot", projectId: project.id })),
  );
  if (addable.length === 0) {
    return <MenuItem disabled>No other bots</MenuItem>;
  }
  return addable.map((bot) => (
    <MenuItem key={bot.id} onClick={() => props.onAdd(bot.id)}>
      {bot.title}
    </MenuItem>
  ));
}

function RoomHeader({
  environmentId,
  room,
  me,
  people,
}: {
  environmentId: EnvironmentId;
  room: RoomSummary;
  me: RoomParticipant;
  people: ReadonlyArray<RoomPerson>;
}) {
  const navigate = useNavigate();
  const commands = useRoomCommands(environmentId);
  const myKey = roomParticipantKey(me);
  const canManage = me.kind === "owner" || roomParticipantKey(room.createdBy) === myKey;
  const inRoom = new Set(room.participants.map((entry) => roomParticipantKey(entry.participant)));
  // The list names who this session may bring in: the owner and members, minus the viewer.
  const addablePeople = people.filter((entry) => !inRoom.has(roomParticipantKey(entry.person)));
  const others = room.participants.filter(
    (entry) => roomParticipantKey(entry.participant) !== myKey,
  );

  return (
    <header className="flex items-center gap-3 border-b px-4 py-2.5">
      <RoomAvatar environmentId={environmentId} participants={room.participants} size={32} />
      <div className="min-w-0 flex-1">
        <h1 className="flex items-center gap-1.5 truncate font-medium text-sm">
          {room.title}
          {room.muted ? <BellOffIcon aria-label="Muted" className="size-3.5 opacity-60" /> : null}
        </h1>
        <p className="truncate text-muted-foreground text-xs">
          {room.participants.map((entry) => entry.name).join(", ")}
        </p>
      </div>
      <Menu>
        <MenuTrigger
          render={<Button aria-label="Group chat options" size="icon-sm" variant="ghost" />}
        >
          <EllipsisIcon />
        </MenuTrigger>
        <MenuPopup align="end">
          {canManage ? (
            <MenuSub>
              <MenuSubTrigger>Add a bot</MenuSubTrigger>
              <MenuSubPopup>
                <AddBotItems
                  environmentId={environmentId}
                  inRoom={inRoom}
                  onAdd={(projectId) => void commands.add(room.id, { kind: "bot", projectId })}
                />
              </MenuSubPopup>
            </MenuSub>
          ) : null}
          {canManage && addablePeople.length > 0 ? (
            <MenuSub>
              <MenuSubTrigger>Add a person</MenuSubTrigger>
              <MenuSubPopup>
                {addablePeople.map((entry) => (
                  <MenuItem
                    key={roomParticipantKey(entry.person)}
                    onClick={() => void commands.add(room.id, entry.person)}
                  >
                    {entry.name}
                  </MenuItem>
                ))}
              </MenuSubPopup>
            </MenuSub>
          ) : null}
          {canManage && others.length > 0 ? (
            <MenuSub>
              <MenuSubTrigger>Take out</MenuSubTrigger>
              <MenuSubPopup>
                {others.map((entry) => (
                  <MenuItem
                    key={roomParticipantKey(entry.participant)}
                    onClick={() => void commands.remove(room.id, entry.participant, entry.name)}
                  >
                    {entry.name}
                  </MenuItem>
                ))}
              </MenuSubPopup>
            </MenuSub>
          ) : null}
          {canManage ? (
            <MenuItem
              onClick={() =>
                openRenameRoomDialog({ environmentId, roomId: room.id, title: room.title })
              }
            >
              Rename…
            </MenuItem>
          ) : null}
          <MenuItem onClick={() => void commands.setMuted(room.id, !room.muted)}>
            {room.muted ? "Unmute" : "Mute"}
          </MenuItem>
          {canManage ? (
            <MenuItem onClick={() => void commands.setArchived(room.id, room.archivedAt === null)}>
              {room.archivedAt === null ? "Archive" : "Unarchive"}
            </MenuItem>
          ) : null}
          <MenuSeparator />
          <MenuItem
            onClick={async () => {
              if (await commands.leave(room.id, room.title)) void navigate({ to: "/" });
            }}
          >
            Leave
          </MenuItem>
          {canManage ? (
            <MenuItem
              variant="destructive"
              onClick={async () => {
                if (await commands.delete(room.id, room.title)) void navigate({ to: "/" });
              }}
            >
              Delete
            </MenuItem>
          ) : null}
        </MenuPopup>
      </Menu>
    </header>
  );
}

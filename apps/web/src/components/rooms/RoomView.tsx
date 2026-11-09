import { useAtomValue } from "@effect/atom-react";
import {
  type EnvironmentId,
  EnvironmentMemberId,
  type ProjectId,
  type RoomId,
  type RoomParticipant,
  roomParticipantKey,
  type RoomSummary,
} from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { BellOffIcon, EllipsisIcon } from "lucide-react";

import { useProjects } from "../../state/entities";
import { memberEnvironment, useMembers } from "../../state/members";
import { useRooms } from "../../state/rooms";
import { Button } from "../ui/button";
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
import { RoomAvatar } from "./RoomAvatar";
import { RoomComposer } from "./RoomComposer";
import { RoomRequests } from "./RoomRequests";
import { type RoomBot, RoomTimeline } from "./RoomTimeline";
import { useRoomCommands } from "./useRoomCommands";

export function RoomPage(props: {
  readonly environmentId: EnvironmentId;
  readonly roomId: RoomId;
}) {
  const { rooms, loaded } = useRooms(props.environmentId);
  const room = rooms.find((entry) => entry.id === props.roomId);
  if (!loaded) return null;
  if (room === undefined || !room.joined) {
    return (
      <div className="flex flex-1 items-center justify-center p-6 text-muted-foreground text-sm">
        This group chat is gone, or you are not in it.
      </div>
    );
  }
  return <RoomView environmentId={props.environmentId} room={room} />;
}

function RoomView({ environmentId, room }: { environmentId: EnvironmentId; room: RoomSummary }) {
  const projects = useProjects();
  const sessionMember = useAtomValue(memberEnvironment.sessionMemberAtom(environmentId));
  const me: RoomParticipant =
    sessionMember === null
      ? { kind: "owner" }
      : { kind: "member", memberId: EnvironmentMemberId.make(sessionMember.id) };
  const myKey = roomParticipantKey(me);
  const bots: ReadonlyArray<RoomBot> = room.participants.flatMap((entry) =>
    entry.participant.kind === "bot"
      ? [
          {
            projectId: entry.participant.projectId,
            name: entry.name,
            avatar:
              projects.find(
                (project) =>
                  project.environmentId === environmentId &&
                  project.id === (entry.participant as { projectId: ProjectId }).projectId,
              )?.avatar ?? null,
          },
        ]
      : [],
  );
  const working = bots.filter((bot) => room.working.includes(bot.projectId));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <RoomHeader environmentId={environmentId} room={room} me={me} />
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

function RoomHeader({
  environmentId,
  room,
  me,
}: {
  environmentId: EnvironmentId;
  room: RoomSummary;
  me: RoomParticipant;
}) {
  const navigate = useNavigate();
  const commands = useRoomCommands(environmentId);
  const projects = useProjects();
  const { members } = useMembers(environmentId);
  const isOwner = me.kind === "owner";
  const canManage = isOwner || roomParticipantKey(room.createdBy) === roomParticipantKey(me);
  const inRoom = new Set(room.participants.map((entry) => roomParticipantKey(entry.participant)));
  const addableBots = projects.filter(
    (project) =>
      project.environmentId === environmentId &&
      !project.isScratch &&
      !inRoom.has(roomParticipantKey({ kind: "bot", projectId: project.id })),
  );
  const addablePeople = members.filter(
    (member) => !inRoom.has(roomParticipantKey({ kind: "member", memberId: member.id })),
  );
  const others = room.participants.filter(
    (entry) => roomParticipantKey(entry.participant) !== roomParticipantKey(me),
  );
  const rename = () => {
    const title = window.prompt("Rename group chat", room.title)?.trim();
    if (title && title !== room.title) void commands.rename(room.id, title);
  };

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
          {canManage && addableBots.length > 0 ? (
            <MenuSub>
              <MenuSubTrigger>Add a bot</MenuSubTrigger>
              <MenuSubPopup>
                {addableBots.map((bot) => (
                  <MenuItem
                    key={bot.id}
                    onClick={() => void commands.add(room.id, { kind: "bot", projectId: bot.id })}
                  >
                    {bot.title}
                  </MenuItem>
                ))}
              </MenuSubPopup>
            </MenuSub>
          ) : null}
          {canManage && isOwner && addablePeople.length > 0 ? (
            <MenuSub>
              <MenuSubTrigger>Add a person</MenuSubTrigger>
              <MenuSubPopup>
                {addablePeople.map((member) => (
                  <MenuItem
                    key={member.id}
                    onClick={() =>
                      void commands.add(room.id, { kind: "member", memberId: member.id })
                    }
                  >
                    {member.label}
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
                    onClick={() => void commands.remove(room.id, entry.participant)}
                  >
                    {entry.name}
                  </MenuItem>
                ))}
              </MenuSubPopup>
            </MenuSub>
          ) : null}
          {canManage ? <MenuItem onClick={rename}>Rename…</MenuItem> : null}
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

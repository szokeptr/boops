import { useAtomValue } from "@effect/atom-react";
import {
  type EnvironmentId,
  roomParticipantKey,
  type RoomParticipantView,
} from "@t3tools/contracts";

import { useProjects } from "../../state/entities";
import { memberEnvironment } from "../../state/members";
import { BotAvatar } from "../bots/BotAvatar";

/** A person in a group avatar: a contact silhouette, since people have no picture here. */
export function PersonFace({ size }: { readonly size: number }) {
  return (
    <span
      className="block overflow-hidden rounded-full bg-gradient-to-b from-muted-foreground/45 to-muted-foreground/70"
      style={{ width: size, height: size }}
    >
      <svg viewBox="0 0 32 32" className="size-full text-white" aria-hidden>
        <circle cx="16" cy="12.5" r="5.5" fill="currentColor" />
        <path d="M5.5 29.5c1.2-6 5.4-9.5 10.5-9.5s9.3 3.5 10.5 9.5z" fill="currentColor" />
      </svg>
    </span>
  );
}

/**
 * A group chat's picture, as phones draw one: a larger face up top and a smaller one tucked in
 * below. It shows a bot and a person when the room has both; the person is someone else in the
 * room, or you when you are its only person.
 */
export function RoomAvatar(props: {
  readonly environmentId: EnvironmentId;
  readonly participants: ReadonlyArray<RoomParticipantView>;
  readonly size: number;
}) {
  const projects = useProjects();
  const sessionMember = useAtomValue(memberEnvironment.sessionMemberAtom(props.environmentId));
  const myKey = sessionMember === null ? "owner" : `member:${sessionMember.id}`;
  const bots = props.participants.filter((entry) => entry.participant.kind === "bot");
  const people = props.participants
    .filter((entry) => entry.participant.kind !== "bot")
    .sort(
      (a, b) =>
        Number(roomParticipantKey(a.participant) === myKey) -
        Number(roomParticipantKey(b.participant) === myKey),
    );
  const shown = bots[0] === undefined ? people.slice(0, 2) : [bots[0], ...people.slice(0, 1)];
  const face = (entry: RoomParticipantView | undefined, size: number) => {
    if (entry === undefined) return null;
    const participant = entry.participant;
    if (participant.kind !== "bot") return <PersonFace size={size} />;
    const avatar =
      projects.find(
        (project) =>
          project.environmentId === props.environmentId && project.id === participant.projectId,
      )?.avatar ?? null;
    return <BotAvatar avatar={avatar} name={entry.name} status="idle" size={size} />;
  };
  const { size } = props;
  const [first, second] = shown;
  return (
    <span aria-hidden className="relative block shrink-0" style={{ width: size, height: size }}>
      {second === undefined ? (
        <span className="absolute inset-0 flex items-center justify-center">
          {face(first, size)}
        </span>
      ) : (
        <>
          {/* A notch cut where the small face sits keeps them apart on any background. */}
          <span
            className="absolute top-0 left-0"
            style={{
              maskImage: `radial-gradient(circle at ${size * 0.75}px ${size * 0.75}px, transparent ${size * 0.25 + 2}px, black ${size * 0.25 + 2.5}px)`,
            }}
          >
            {face(first, Math.round(size * 0.7))}
          </span>
          <span className="absolute right-0 bottom-0">{face(second, Math.round(size * 0.5))}</span>
        </>
      )}
    </span>
  );
}

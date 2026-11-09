import type { EnvironmentId, RoomId } from "@t3tools/contracts";
import { createFileRoute } from "@tanstack/react-router";

import { RoomPage } from "../components/rooms/RoomView";

function RoomRouteView() {
  const { environmentId, roomId } = Route.useParams();
  return (
    <RoomPage
      key={`${environmentId}:${roomId}`}
      environmentId={environmentId as EnvironmentId}
      roomId={roomId as RoomId}
    />
  );
}

export const Route = createFileRoute("/_chat/rooms/$environmentId/$roomId")({
  component: RoomRouteView,
});

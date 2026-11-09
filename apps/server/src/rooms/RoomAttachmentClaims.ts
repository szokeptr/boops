import { type ChatAttachment, type RoomId, RoomsError } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { claimPendingAttachments } from "../orchestration-v2/AttachmentClaims.ts";

/**
 * Takes a room message's uploads off the pending shelf and files them under the room, the way a
 * thread's send claims them. Bots that answer get the same ids, which resolve on their own.
 */
export class RoomAttachmentClaims extends Context.Service<
  RoomAttachmentClaims,
  {
    readonly claim: (
      roomId: RoomId,
      attachments: ReadonlyArray<ChatAttachment>,
    ) => Effect.Effect<ReadonlyArray<ChatAttachment>, RoomsError>;
  }
>()("boops/rooms/RoomAttachmentClaims") {}

export const layer = Layer.effect(
  RoomAttachmentClaims,
  Effect.gen(function* () {
    const context =
      yield* Effect.context<Effect.Services<ReturnType<typeof claimPendingAttachments>>>();
    return RoomAttachmentClaims.of({
      claim: Effect.fn("RoomAttachmentClaims.claim")(function* (roomId, attachments) {
        if (attachments.length === 0) return attachments;
        const claimed = yield* claimPendingAttachments({
          threadId: `room-${roomId}`,
          attachments,
        }).pipe(
          Effect.provideContext(context),
          Effect.mapError((cause) => new RoomsError({ reason: "attachment-failed", cause })),
        );
        return claimed.attachments;
      }),
    });
  }),
);

import { createClerkClient } from "@clerk/backend";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";

import * as RelayConfiguration from "../Config.ts";

const CLERK_REQUEST_TIMEOUT = "5 seconds";

export class ClerkEmailLookupFailed extends Schema.TaggedError<ClerkEmailLookupFailed>()(
  "ClerkEmailLookupFailed",
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return "Could not read the Clerk user's primary email";
  }
}

export const normalizeEmail = (email: string): string => email.trim().toLowerCase();

export class ClerkUsers extends Context.Service<
  ClerkUsers,
  {
    /** Normalized, or null when the user has no verified primary email. */
    readonly verifiedPrimaryEmail: (
      userId: string,
    ) => Effect.Effect<string | null, ClerkEmailLookupFailed>;
  }
>()("t3code-relay/auth/ClerkUsers") {}

export const layer = Layer.effect(
  ClerkUsers,
  Effect.gen(function* () {
    const config = yield* RelayConfiguration.RelayConfiguration;
    return ClerkUsers.of({
      verifiedPrimaryEmail: Effect.fn("relay.clerk.verified_primary_email")(function* (userId) {
        return yield* Effect.tryPromise({
          try: async () => {
            const user = await createClerkClient({
              secretKey: Redacted.value(config.clerkSecretKey),
              publishableKey: config.clerkPublishableKey,
            }).users.getUser(userId);
            const primary = user.primaryEmailAddress;
            return primary && primary.verification?.status === "verified"
              ? normalizeEmail(primary.emailAddress)
              : null;
          },
          catch: (cause) => new ClerkEmailLookupFailed({ cause }),
        }).pipe(
          Effect.timeoutOrElse({
            duration: CLERK_REQUEST_TIMEOUT,
            orElse: () => Effect.fail(new ClerkEmailLookupFailed({ cause: "timed out" })),
          }),
        );
      }),
    });
  }),
);

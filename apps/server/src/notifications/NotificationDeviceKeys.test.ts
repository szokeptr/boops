import { assert, it } from "@effect/vitest";
import {
  EnvironmentMemberId,
  memberSessionSubject,
  NotificationDeviceId,
  NotificationDevicePublicKey,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as NotificationDeviceKeys from "./NotificationDeviceKeys.ts";

const anna = EnvironmentMemberId.make("member-anna");
const annaSubject = memberSessionSubject(anna);
const ownerSubject = "owner-session";
const key = (seed: string) => NotificationDevicePublicKey.make(seed.repeat(43).slice(0, 43));
const device = (id: string) => NotificationDeviceId.make(id);

const layer = NotificationDeviceKeys.layer.pipe(Layer.provide(SqlitePersistence.layerMemory));

it.effect("files phones under the caller's audience and moves a phone that changes hands", () =>
  Effect.gen(function* () {
    const keys = yield* NotificationDeviceKeys.NotificationDeviceKeys;
    yield* keys.register(ownerSubject, { deviceId: device("phone-1"), publicKey: key("a") });
    yield* keys.register(annaSubject, { deviceId: device("phone-2"), publicKey: key("b") });
    assert.deepEqual(yield* keys.listForAudience(undefined), [
      { deviceId: device("phone-1"), publicKey: key("a") },
    ]);
    assert.deepEqual(yield* keys.listForAudience(anna), [
      { deviceId: device("phone-2"), publicKey: key("b") },
    ]);

    // Anna cannot remove the owner's phone; signing in as her moves it, with its new key.
    yield* keys.remove(annaSubject, device("phone-1"));
    assert.equal((yield* keys.listForAudience(undefined)).length, 1);
    yield* keys.register(annaSubject, { deviceId: device("phone-1"), publicKey: key("c") });
    assert.deepEqual(yield* keys.listForAudience(undefined), []);
    assert.deepEqual(
      (yield* keys.listForAudience(anna)).map((entry) => entry.publicKey).toSorted(),
      [key("b"), key("c")],
    );

    yield* keys.remove(annaSubject, device("phone-2"));
    assert.deepEqual(yield* keys.listForAudience(anna), [
      { deviceId: device("phone-1"), publicKey: key("c") },
    ]);
    yield* keys.removeMember(anna);
    assert.deepEqual(yield* keys.listForAudience(anna), []);
  }).pipe(Effect.provide(layer)),
);

it.effect("refuses a phone past the per-audience cap but still updates a registered one", () =>
  Effect.gen(function* () {
    const keys = yield* NotificationDeviceKeys.NotificationDeviceKeys;
    for (
      let index = 0;
      index < NotificationDeviceKeys.MAX_NOTIFICATION_DEVICES_PER_AUDIENCE;
      index++
    ) {
      yield* keys.register(ownerSubject, {
        deviceId: device(`phone-${index}`),
        publicKey: key("a"),
      });
    }
    const refused = yield* keys
      .register(ownerSubject, { deviceId: device("phone-extra"), publicKey: key("a") })
      .pipe(Effect.flip);
    assert.equal(refused.reason, "limit-reached");
    yield* keys.register(ownerSubject, { deviceId: device("phone-0"), publicKey: key("b") });
    // Another audience has its own allowance.
    yield* keys.register(annaSubject, { deviceId: device("phone-extra"), publicKey: key("a") });
  }).pipe(Effect.provide(layer)),
);

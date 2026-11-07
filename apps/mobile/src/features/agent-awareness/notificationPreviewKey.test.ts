/// <reference types="node" />

import * as NodeCrypto from "node:crypto";

import { EnvironmentId, NotificationDevicePublicKey } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  decodeStoredNotificationPreviewKey,
  notificationPreviewKeyPairFromPrivateKey,
} from "./notificationPreviewKey";
import { environmentsNeedingNotificationPreviewKeySync } from "./notificationPreviewKeySync.logic";

vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));
vi.mock("expo-constants", () => ({ default: {} }));
vi.mock("expo-secure-store", () => ({}));
vi.mock("expo-crypto", () => ({}));

const isNotificationDevicePublicKey = Schema.is(NotificationDevicePublicKey);
const PKCS8_X25519_PREFIX = Buffer.from("302e020100300506032b656e04220420", "hex");

describe("notification preview key", () => {
  it("publishes the standard X25519 public key that sealers and CryptoKit derive", () => {
    const privateKey = new Uint8Array(NodeCrypto.randomBytes(32));
    const pair = notificationPreviewKeyPairFromPrivateKey(privateKey);
    const nodePrivateKey = NodeCrypto.createPrivateKey({
      key: Buffer.concat([PKCS8_X25519_PREFIX, privateKey]),
      format: "der",
      type: "pkcs8",
    });
    const nodePublicKey = NodeCrypto.createPublicKey(nodePrivateKey).export({ format: "jwk" });
    expect(pair.publicKey).toBe(nodePublicKey.x);
    expect(isNotificationDevicePublicKey(pair.publicKey)).toBe(true);
    expect(decodeStoredNotificationPreviewKey(pair.privateKey)).toEqual(pair);
  });

  it.each(["", "not base64!", Buffer.alloc(31).toString("base64url")])(
    "treats a stored value of %j as no key",
    (stored) => {
      expect(decodeStoredNotificationPreviewKey(stored)).toBeNull();
    },
  );
});

describe("environmentsNeedingNotificationPreviewKeySync", () => {
  const a = EnvironmentId.make("environment-a");
  const b = EnvironmentId.make("environment-b");

  it("registers once per environment and key, and again after the key changes or is removed", () => {
    const synced = new Map([
      [a, "key-1"],
      [b, "removed"],
    ]);
    expect(
      environmentsNeedingNotificationPreviewKeySync({
        environmentIds: [a, b],
        intent: { kind: "register", publicKey: "key-1" },
        synced,
      }),
    ).toEqual([b]);
    expect(
      environmentsNeedingNotificationPreviewKeySync({
        environmentIds: [a, b],
        intent: { kind: "register", publicKey: "key-2" },
        synced,
      }),
    ).toEqual([a, b]);
    expect(
      environmentsNeedingNotificationPreviewKeySync({
        environmentIds: [a, b],
        intent: { kind: "remove" },
        synced,
      }),
    ).toEqual([a]);
  });
});

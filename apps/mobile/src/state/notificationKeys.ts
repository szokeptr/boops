import { createEnvironmentRpcCommand } from "@t3tools/client-runtime/state/runtime";
import { WS_METHODS } from "@t3tools/contracts";

import { connectionAtomRuntime } from "../connection/runtime";

/** Lets an environment seal bot reply previews to this phone; owners and members alike. */
export const notificationKeyEnvironment = {
  registerDeviceKey: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "environment-data:notifications:register-device-key",
    tag: WS_METHODS.notificationsRegisterDeviceKey,
  }),
  removeDeviceKey: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "environment-data:notifications:remove-device-key",
    tag: WS_METHODS.notificationsRemoveDeviceKey,
  }),
};

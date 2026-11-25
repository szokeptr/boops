import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import * as Notifications from "expo-notifications";
import * as TaskManager from "expo-task-manager";
import { AppState } from "react-native";

import { extractAgentNotificationTaskThread } from "./notificationPayload";

const BACKGROUND_THREAD_REFRESH_TASK = "t3-agent-thread-refresh";

// The task must be defined at module scope: a push can start the app headless, with no screen.
TaskManager.defineTask<Notifications.NotificationTaskPayload>(
  BACKGROUND_THREAD_REFRESH_TASK,
  async ({ data }) => {
    const thread = extractAgentNotificationTaskThread(data);
    // On screen the live connection already shows the reply.
    if (thread === null || AppState.currentState === "active") {
      return Notifications.BackgroundNotificationTaskResult.NoData;
    }
    try {
      const { refreshEnvironmentThreadForPush } = await import("../../state/threads");
      const caughtUp = await refreshEnvironmentThreadForPush(
        EnvironmentId.make(thread.environmentId),
        ThreadId.make(thread.threadId),
      );
      return caughtUp
        ? Notifications.BackgroundNotificationTaskResult.NewData
        : Notifications.BackgroundNotificationTaskResult.NoData;
    } catch (cause) {
      console.warn("Could not refresh the notified thread", cause);
      return Notifications.BackgroundNotificationTaskResult.Failed;
    }
  },
);

void Notifications.registerTaskAsync(BACKGROUND_THREAD_REFRESH_TASK).catch((cause: unknown) => {
  console.warn("Could not register the notification refresh task", cause);
});

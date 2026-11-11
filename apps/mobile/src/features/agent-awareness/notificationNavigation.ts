import * as Notifications from "expo-notifications";
import { AppState } from "react-native";

import {
  dismissAndroidThreadNotifications,
  setAndroidThreadOnScreen,
} from "./androidNotifications";
import { foregroundNotificationBehavior } from "./foregroundNotificationBehavior";
import {
  extractAgentNotificationDeepLink,
  routeAgentNotificationResponseOnce,
  threadDeepLinkOnScreen,
} from "./notificationPayload";
import { consumeLastAgentNotificationResponse } from "./notificationResponseConsumer";

let deepLinkOnScreen: string | null = null;

/** Called with the workspace pathname on every root navigation state change. */
export function setAgentNotificationPathname(pathname: string): void {
  const previous = deepLinkOnScreen;
  deepLinkOnScreen = threadDeepLinkOnScreen(pathname);
  setAndroidThreadOnScreen(deepLinkOnScreen);
  if (deepLinkOnScreen !== previous && AppState.currentState === "active") {
    dismissThreadNotifications(deepLinkOnScreen);
  }
}

/** Opening a conversation reads it, so its delivered notifications leave the tray. */
function dismissThreadNotifications(deepLink: string | null): void {
  if (deepLink === null) return;
  dismissAndroidThreadNotifications(deepLink);
  void Notifications.getPresentedNotificationsAsync()
    .then((presented) =>
      Promise.all(
        presented
          .filter((notification) => extractAgentNotificationDeepLink({ notification }) === deepLink)
          .map((notification) =>
            Notifications.dismissNotificationAsync(notification.request.identifier),
          ),
      ),
    )
    .catch((cause: unknown) => {
      console.warn("Could not dismiss the open thread's notifications", cause);
    });
}

/**
 * App-lifetime notification routing: foreground presentation suppresses the
 * thread already on screen, and taps (including the cold-start tap) open the
 * notification's deep link through `navigate`.
 */
export function installAgentNotificationNavigation(navigate: (href: string) => void): () => void {
  const handledResponseIds = new Set<string>();
  Notifications.setNotificationHandler({
    handleNotification: (notification) =>
      Promise.resolve(foregroundNotificationBehavior(notification, deepLinkOnScreen)),
  });

  const handleResponse = (response: Notifications.NotificationResponse): void => {
    routeAgentNotificationResponseOnce({ handledResponseIds, response, navigate });
  };
  const subscription = Notifications.addNotificationResponseReceivedListener(handleResponse);
  const appStateSubscription = AppState.addEventListener("change", (state) => {
    if (state === "active") dismissThreadNotifications(deepLinkOnScreen);
  });
  void consumeLastAgentNotificationResponse({
    getLastResponse: () => Notifications.getLastNotificationResponseAsync(),
    clearLastResponse: () => Notifications.clearLastNotificationResponseAsync(),
    handleResponse,
  });

  return () => {
    subscription.remove();
    appStateSubscription.remove();
    Notifications.setNotificationHandler(null);
  };
}

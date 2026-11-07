import * as Electron from "electron";
import * as Effect from "effect/Effect";

/**
 * Has macOS ask for the microphone the first time the app wants it, for calls with bots.
 * Without a handler Electron grants every permission, so all other requests stay granted.
 * Preview browsers use their own partitions and handlers.
 */
export const configure = Effect.sync(() => {
  Electron.session.defaultSession.setPermissionRequestHandler(
    (_webContents, permission, callback, details) => {
      const mediaTypes = "mediaTypes" in details ? (details.mediaTypes ?? []) : [];
      if (
        permission !== "media" ||
        !mediaTypes.includes("audio") ||
        Electron.systemPreferences.getMediaAccessStatus("microphone") === "granted"
      ) {
        callback(true);
        return;
      }
      Electron.systemPreferences
        .askForMediaAccess("microphone")
        .then(callback, () => callback(false));
    },
  );
}).pipe(
  Effect.catchCause((cause) =>
    Effect.logWarning("could not set up microphone permission prompts", { cause }),
  ),
);

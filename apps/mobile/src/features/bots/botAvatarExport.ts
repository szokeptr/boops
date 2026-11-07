import type { EnvironmentProject } from "@t3tools/client-runtime/state/models";
import * as Base64 from "effect/encoding/Base64";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import Constants from "expo-constants";
import { Platform } from "react-native";

import { appAtomRegistry } from "../../state/atom-registry";
import { environmentProjects } from "../../state/projects";
import { environmentShell } from "../../state/shell";
import { BOT_AVATAR_IMAGE_SIZE, BotAvatarManifest, planBotAvatarExport } from "./botAvatarImage";

const AVATAR_DIRECTORY = "avatars";
const MANIFEST_NAME = "manifest.json";
// Project shells change on every reply; avatars only when a bot is renamed or restyled.
const EXPORT_DEBOUNCE_MS = 2_000;

function appGroupIdentifier(): string | null {
  if (Platform.OS !== "ios") return null;
  const group: unknown = Constants.expoConfig?.extra?.notificationService?.appGroup;
  return typeof group === "string" && group.length > 0 ? group : null;
}

const decodeManifest = Schema.decodeUnknownOption(Schema.fromJsonString(BotAvatarManifest));

async function renderPng(svg: string): Promise<string> {
  const [{ Image }, { ImageManipulator, SaveFormat }] = await Promise.all([
    import("expo-image"),
    import("expo-image-manipulator"),
  ]);
  // expo-image rasterizes SVG when given a pixel bound; the manipulator only encodes.
  const source = await Image.loadAsync(
    { uri: `data:image/svg+xml;base64,${Base64.encode(svg)}` },
    { maxWidth: BOT_AVATAR_IMAGE_SIZE, maxHeight: BOT_AVATAR_IMAGE_SIZE },
  );
  try {
    const rendered = await ImageManipulator.manipulate(source).renderAsync();
    try {
      return (await rendered.saveAsync({ format: SaveFormat.PNG })).uri;
    } finally {
      rendered.release();
    }
  } finally {
    source.release();
  }
}

/**
 * Keeps each bot's face as a PNG in the App Group, where the Notification Service Extension
 * reads it to show the bot as the sender. Writes only drawings that changed, and deletes the
 * files of archived or deleted bots. App-lifetime; iOS builds with the extension only.
 */
export function installBotAvatarExport(): () => void {
  const group = appGroupIdentifier();
  if (!group) return () => {};
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let rerun = false;
  let manifest: BotAvatarManifest | null = null;

  const run = async () => {
    const { Directory, File, Paths } = await import("expo-file-system");
    const container = Paths.appleSharedContainers[group];
    if (!container) return;
    const directory = new Directory(container, AVATAR_DIRECTORY);
    if (!directory.exists) directory.create({ intermediates: true, idempotent: true });
    const manifestFile = new File(directory, MANIFEST_NAME);
    manifest ??= manifestFile.exists
      ? Option.getOrElse(decodeManifest(await manifestFile.text()), () => ({}))
      : {};
    const projects: ReadonlyArray<EnvironmentProject> = appAtomRegistry.get(
      environmentProjects.projectsAtom,
    );
    const plan = planBotAvatarExport({
      projects,
      manifest,
      exists: (fileName) => new File(directory, fileName).exists,
      isLive: (environmentId) =>
        appAtomRegistry.get(environmentShell.stateValueAtom(environmentId)).status === "live",
    });
    if (plan.write.length === 0 && plan.remove.length === 0) return;
    const next: Record<string, BotAvatarManifest[string]> = { ...manifest };

    for (const avatar of plan.write) {
      if (disposed) return;
      const file = new File(directory, avatar.fileName);
      try {
        new File(await renderPng(avatar.svg)).moveSync(file, { overwrite: true });
        next[avatar.fileName] = {
          signature: avatar.signature,
          environmentId: avatar.environmentId,
        };
      } catch (error) {
        if (__DEV__) console.warn("[bot-avatars] could not export an avatar", error);
      }
    }
    for (const fileName of plan.remove) {
      const file = new File(directory, fileName);
      if (file.exists) file.delete();
      delete next[fileName];
    }

    manifest = next;
    await manifestFile.write(JSON.stringify(next));
  };

  const flush = () => {
    timer = null;
    if (disposed) return;
    if (running) {
      rerun = true;
      return;
    }
    running = true;
    void run()
      .catch((error: unknown) => {
        if (__DEV__) console.warn("[bot-avatars] export failed", error);
      })
      .finally(() => {
        running = false;
        if (rerun) {
          rerun = false;
          schedule();
        }
      });
  };

  function schedule() {
    if (disposed) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, EXPORT_DEBOUNCE_MS);
  }

  const unsubscribe = appAtomRegistry.subscribe(environmentProjects.projectsAtom, schedule, {
    immediate: true,
  });
  return () => {
    disposed = true;
    if (timer) clearTimeout(timer);
    unsubscribe();
  };
}

import {
  AVATAR_CANVAS,
  avatarColors,
  type AvatarShape,
  avatarShapes,
} from "@t3tools/client-runtime/bot-avatar";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/models";
import { EnvironmentId, type ProjectAvatar } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { lookFor } from "@t3tools/shared/botAvatar";

/** Pixels square; iOS shows a Communication Notification's sender at up to 60pt @3x. */
export const BOT_AVATAR_IMAGE_SIZE = 180;

function shapeElement(shape: AvatarShape): string {
  switch (shape.kind) {
    case "rect":
      return `<rect x="${shape.x}" y="${shape.y}" width="${shape.w}" height="${shape.h}" rx="${shape.r}" fill="${shape.fill}"${shape.opacity === undefined ? "" : ` opacity="${shape.opacity}"`}/>`;
    case "circle":
      return `<circle cx="${shape.cx}" cy="${shape.cy}" r="${shape.r}" fill="${shape.fill}"/>`;
    case "path":
      return [
        `<path d="${shape.d}" fill="${shape.fill ?? "none"}"`,
        shape.stroke ? ` stroke="${shape.stroke}" stroke-linejoin="round"` : "",
        shape.strokeWidth === undefined ? "" : ` stroke-width="${shape.strokeWidth}"`,
        shape.linecap ? ` stroke-linecap="${shape.linecap}"` : "",
        shape.opacity === undefined ? "" : ` opacity="${shape.opacity}"`,
        shape.transform ? ` transform="${shape.transform}"` : "",
        "/>",
      ].join("");
  }
}

/**
 * The bot's idle face on a pale disc of its hue, like a contact photo. iOS crops the sender
 * image to a circle, so the blob is inset to keep its ears and hats inside it.
 */
function botAvatarSvg(avatar: ProjectAvatar | null, name: string): string {
  const look = lookFor(avatar, name);
  const half = AVATAR_CANVAS / 2;
  const shapes = avatarShapes(look, "idle", BOT_AVATAR_IMAGE_SIZE).map(shapeElement).join("");
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${BOT_AVATAR_IMAGE_SIZE}" height="${BOT_AVATAR_IMAGE_SIZE}" viewBox="0 0 ${AVATAR_CANVAS} ${AVATAR_CANVAS}">`,
    `<rect width="${AVATAR_CANVAS}" height="${AVATAR_CANVAS}" fill="${avatarColors(look).light}"/>`,
    `<g transform="translate(${half} ${half + 2}) scale(0.78) translate(${-half} ${-half})">${shapes}</g>`,
    "</svg>",
  ].join("");
}

/**
 * The App Group file the Notification Service Extension shows as the bot's face. Keep in sync
 * with `avatarFileName` in plugins/notification-service/NotificationService.swift.
 */
export function botAvatarFileName(environmentId: string, projectId: string): string {
  const safe = (value: string) => value.replace(/[^A-Za-z0-9_-]/g, "_");
  return `${safe(environmentId)}--${safe(projectId)}.png`;
}

/** FNV-1a, enough to tell whether a bot's drawing changed since it was last written. */
function botAvatarSignature(svg: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < svg.length; i++) {
    hash ^= svg.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

/** The PNGs already written, by file name. */
export const BotAvatarManifest = Schema.Record(
  Schema.String,
  Schema.Struct({ signature: Schema.String, environmentId: EnvironmentId }),
);
export type BotAvatarManifest = typeof BotAvatarManifest.Type;

interface BotAvatarWrite {
  readonly fileName: string;
  readonly environmentId: EnvironmentId;
  readonly signature: string;
  readonly svg: string;
}

/**
 * Which faces to draw and which files to delete. A file goes once its bot is archived, or is
 * missing from an environment whose shell is live; a cached or offline shell proves nothing.
 */
export function planBotAvatarExport(input: {
  readonly projects: ReadonlyArray<
    Pick<
      EnvironmentProject,
      "environmentId" | "id" | "title" | "avatar" | "archivedAt" | "isScratch"
    >
  >;
  readonly manifest: BotAvatarManifest;
  readonly exists: (fileName: string) => boolean;
  readonly isLive: (environmentId: EnvironmentId) => boolean;
}): { readonly write: ReadonlyArray<BotAvatarWrite>; readonly remove: ReadonlyArray<string> } {
  const wanted = new Set<string>();
  const archived = new Set<string>();
  const write: BotAvatarWrite[] = [];
  for (const project of input.projects) {
    const fileName = botAvatarFileName(project.environmentId, project.id);
    if (project.archivedAt != null || project.isScratch) {
      archived.add(fileName);
      continue;
    }
    wanted.add(fileName);
    const svg = botAvatarSvg(project.avatar ?? null, project.title);
    const signature = botAvatarSignature(svg);
    if (input.manifest[fileName]?.signature === signature && input.exists(fileName)) continue;
    write.push({ fileName, environmentId: project.environmentId, signature, svg });
  }
  const remove = Object.entries(input.manifest).flatMap(([fileName, entry]) =>
    !wanted.has(fileName) && (archived.has(fileName) || input.isLive(entry.environmentId))
      ? [fileName]
      : [],
  );
  return { write, remove };
}

#!/usr/bin/env node

// Renders the Android launcher, splash, monochrome and notification art from the Icon Composer mascot layers.

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import sharp from "sharp";

type IconVariant = "dev" | "nightly" | "prod";

const ADAPTIVE_CANVAS = 432;
const SPLASH_CANVAS = 1152;
const NOTIFICATION_CANVAS = 96;
// Android masks 72dp of the 108dp adaptive canvas and 2/3 of the splash canvas; keep the mascot inside both.
const FOREGROUND_FRACTION = 0.61;
const SPLASH_FRACTION = 0.46;
const MARK_FRACTION = 0.56;
const NOTIFICATION_FRACTION = 0.84;
const SVG_DENSITY = 300;
const OUTPUT_DIRECTORY = "apps/mobile/assets";
// Matches the fill in each assets/<variant>/app-icon.icon/icon.json.
const BACKGROUND: Record<IconVariant, string> = {
  dev: "#FBF8F3",
  nightly: "#86FFCF",
  prod: "#1D1A2A",
};
const FOREGROUND_FILE: Record<IconVariant, string> = {
  dev: "android-icon-foreground-dev.png",
  nightly: "android-icon-foreground-nightly.png",
  prod: "android-icon-foreground.png",
};

export class AndroidIconRenderError extends Schema.TaggedError<AndroidIconRenderError>()(
  "AndroidIconRenderError",
  { layer: Schema.String, cause: Schema.Defect() },
) {}

const attempt = <A>(layer: string, run: () => Promise<A>) =>
  Effect.tryPromise({ try: run, catch: (cause) => new AndroidIconRenderError({ layer, cause }) });

const rasterize = (layer: string, svg: string, size: number) =>
  attempt(layer, () =>
    sharp(Buffer.from(svg), { density: SVG_DENSITY })
      .resize(size, size, { fit: "contain", background: "#00000000" })
      .png()
      .toBuffer(),
  );

const centered = (layer: string, art: Buffer, canvas: number, background: string) =>
  attempt(layer, () =>
    sharp({ create: { width: canvas, height: canvas, channels: 4, background } })
      .composite([{ input: art, gravity: "center" }])
      .png()
      .toBuffer(),
  );

const readSource = Effect.fn("androidIcons.readSource")(function* (
  repositoryRoot: string,
  ...segments: ReadonlyArray<string>
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  return yield* fs.readFileString(path.join(repositoryRoot, "assets", ...segments));
});

const readMascot = (repositoryRoot: string, variant: IconVariant) =>
  readSource(repositoryRoot, variant, "app-icon.icon", "Assets", "mascot.svg");

const TRANSPARENT = "#00000000";

const exportAndroidIcons = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const repositoryRoot = path.resolve(import.meta.dirname, "..");
  const mark = yield* readSource(repositoryRoot, "mark.svg");
  const outputs: Array<readonly [string, Buffer]> = [];
  for (const variant of ["dev", "nightly", "prod"] as const) {
    const mascot = yield* readMascot(repositoryRoot, variant);
    const foreground = yield* rasterize(
      `${variant}-foreground`,
      mascot,
      Math.round(ADAPTIVE_CANVAS * FOREGROUND_FRACTION),
    );
    outputs.push([
      FOREGROUND_FILE[variant],
      yield* centered(`${variant}-foreground`, foreground, ADAPTIVE_CANVAS, TRANSPARENT),
    ]);
    const splashArt = yield* rasterize(
      `${variant}-splash`,
      mascot,
      Math.round(SPLASH_CANVAS * SPLASH_FRACTION),
    );
    outputs.push([
      `android-splash-icon-${variant}.png`,
      yield* centered(`${variant}-splash`, splashArt, SPLASH_CANVAS, BACKGROUND[variant]),
    ]);
  }
  for (const variant of ["dev", "nightly"] as const) {
    outputs.push([
      `android-icon-background-${variant}.png`,
      yield* attempt(`${variant}-background`, () =>
        sharp({
          create: {
            width: ADAPTIVE_CANVAS,
            height: ADAPTIVE_CANVAS,
            channels: 4,
            background: BACKGROUND[variant],
          },
        })
          .png()
          .toBuffer(),
      ),
    ]);
  }
  const markArt = yield* rasterize("mark", mark, Math.round(ADAPTIVE_CANVAS * MARK_FRACTION));
  outputs.push([
    "android-icon-mark.png",
    yield* centered("mark", markArt, ADAPTIVE_CANVAS, TRANSPARENT),
  ]);
  const notificationArt = yield* rasterize(
    "notification",
    mark,
    Math.round(NOTIFICATION_CANVAS * NOTIFICATION_FRACTION),
  );
  outputs.push([
    "android-notification-icon.png",
    yield* centered("notification", notificationArt, NOTIFICATION_CANVAS, TRANSPARENT),
  ]);
  for (const [name, contents] of outputs) {
    yield* fs.writeFile(path.join(repositoryRoot, OUTPUT_DIRECTORY, name), contents);
    yield* Console.log(`wrote ${OUTPUT_DIRECTORY}/${name}`);
  }
});

if (import.meta.main) {
  exportAndroidIcons.pipe(Effect.provide(NodeServices.layer), NodeRuntime.runMain);
}

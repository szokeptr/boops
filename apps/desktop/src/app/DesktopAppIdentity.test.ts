import * as NodePath from "@effect/platform-node/NodePath";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as PlatformError from "effect/PlatformError";

import type * as Electron from "electron";

import * as ElectronApp from "../electron/ElectronApp.ts";
import * as DesktopAppIdentity from "./DesktopAppIdentity.ts";
import * as DesktopConfig from "./DesktopConfig.ts";
import * as DesktopEnvironment from "./DesktopEnvironment.ts";

const defaultEnvironmentInput = {
  dirname: "/repo/apps/desktop/dist-electron",
  homeDirectory: "/Users/alice",
  platform: "darwin",
  processArch: "arm64",
  appVersion: "1.2.3",
  appPath: "/Applications/Boops.app/Contents/Resources/app.asar",
  isPackaged: true,
  resourcesPath: "/Applications/Boops.app/Contents/Resources",
  runningUnderArm64Translation: false,
} satisfies DesktopEnvironment.MakeDesktopEnvironmentInput;

type TestEnvironmentInput = Partial<DesktopEnvironment.MakeDesktopEnvironmentInput> & {
  readonly env?: Record<string, string | undefined>;
};

interface ElectronAppCalls {
  readonly setAboutPanelOptions: Array<Electron.AboutPanelOptionsOptions>;
  readonly setName: string[];
}

const layerElectronApp = (calls: ElectronAppCalls) =>
  Layer.succeed(ElectronApp.ElectronApp, {
    metadata: Effect.die("unexpected metadata read"),
    name: Effect.succeed("Boops"),
    systemLocale: Effect.succeed("en-US"),
    whenReady: Effect.void,
    requestSingleInstanceLock: Effect.succeed(true),
    quit: Effect.void,
    exit: () => Effect.void,
    relaunch: () => Effect.void,
    setPath: () => Effect.void,
    setName: (name) =>
      Effect.sync(() => {
        calls.setName.push(name);
      }),
    setAboutPanelOptions: (options) =>
      Effect.sync(() => {
        calls.setAboutPanelOptions.push(options);
      }),
    setAppUserModelId: () => Effect.void,
    getAppMetrics: Effect.succeed([]),
    setAsDefaultProtocolClient: () => Effect.succeed(true),
    setDesktopName: () => Effect.void,
    appendCommandLineSwitch: () => Effect.void,
    onBeforeQuitForUpdate: () => Effect.void,
    removeCommandLineSwitch: () => Effect.void,
    on: () => Effect.void,
  } satisfies ElectronApp.ElectronApp["Service"]);

const layerEnvironment = (overrides: TestEnvironmentInput = {}) => {
  const { env, ...environmentOverrides } = overrides;
  return DesktopEnvironment.layer({
    ...defaultEnvironmentInput,
    ...environmentOverrides,
  }).pipe(
    Layer.provide(
      Layer.mergeAll(
        NodeServices.layer,
        NodePath.layerPosix,
        DesktopConfig.layerTest({
          ...env,
        }),
      ),
    ),
  );
};

const withIdentity = <A, E, R>(
  effect: Effect.Effect<
    A,
    E,
    | R
    | DesktopAppIdentity.DesktopAppIdentity
    | DesktopEnvironment.DesktopEnvironment
    | FileSystem.FileSystem
  >,
  input: {
    readonly calls?: ElectronAppCalls;
    readonly environment?: TestEnvironmentInput;
    readonly legacyPathExists?: boolean;
    readonly legacyPathProbeError?: PlatformError.PlatformError;
    readonly packageJson?: string;
  } = {},
) => {
  const calls: ElectronAppCalls = input.calls ?? {
    setAboutPanelOptions: [],
    setName: [],
  };

  return effect.pipe(
    Effect.provide(
      DesktopAppIdentity.layer.pipe(
        Layer.provide(NodePath.layerPosix),
        Layer.provideMerge(
          FileSystem.layerNoop({
            exists: (path) =>
              input.legacyPathProbeError
                ? Effect.fail(input.legacyPathProbeError)
                : Effect.succeed(
                    input.legacyPathExists === true && /Boops \((Beta|Dev)\)/.test(path),
                  ),
            readFileString: () =>
              Effect.succeed(input.packageJson ?? '{"t3codeCommitHash":"abcdef1234567890"}'),
          }),
        ),
        Layer.provideMerge(layerElectronApp(calls)),
        Layer.provideMerge(layerEnvironment(input.environment)),
      ),
    ),
  );
};

describe("DesktopAppIdentity", () => {
  it.effect("isolates the V2 profile even when the legacy V1 profile exists", () =>
    withIdentity(
      Effect.gen(function* () {
        const identity = yield* DesktopAppIdentity.DesktopAppIdentity;
        const userDataPath = yield* identity.resolveUserDataPath;

        assert.equal(userDataPath, "/Users/alice/Library/Application Support/boops");
      }),
      { legacyPathExists: true },
    ),
  );

  it.effect("keeps using the legacy development profile", () =>
    withIdentity(
      Effect.gen(function* () {
        const identity = yield* DesktopAppIdentity.DesktopAppIdentity;
        assert.equal(
          yield* identity.resolveUserDataPath,
          "/Users/alice/Library/Application Support/Boops (Dev)",
        );
      }),
      {
        legacyPathExists: true,
        environment: { env: { VITE_DEV_SERVER_URL: "http://localhost:5173" } },
      },
    ),
  );

  it.effect.each([
    { stage: "Beta", environment: {} },
    {
      stage: "Nightly",
      environment: { appVersion: "0.0.43-nightly.20260929.2428" },
    },
    {
      stage: "Dev",
      environment: { env: { VITE_DEV_SERVER_URL: "http://localhost:5173" } },
    },
  ])("uses a valid native User-Agent product name for $stage", ({ stage, environment }) => {
    const calls: ElectronAppCalls = {
      setAboutPanelOptions: [],
      setName: [],
    };

    return withIdentity(
      Effect.gen(function* () {
        const identity = yield* DesktopAppIdentity.DesktopAppIdentity;
        yield* identity.configure;

        const runtimeName = calls.setName[0];
        assert.isDefined(runtimeName);
        assert.equal(runtimeName, `Boops ${stage}`);
        assert.match(runtimeName.replaceAll(" ", ""), /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/);
        assert.equal(calls.setAboutPanelOptions[0]?.applicationName, `Boops (${stage})`);
      }),
      { calls, environment },
    );
  });
});

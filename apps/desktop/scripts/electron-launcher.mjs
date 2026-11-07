import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeModule from "node:module";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import { ensureElectronRuntime } from "./ensure-electron-runtime.mjs";

const isDevelopment = Boolean(process.env.VITE_DEV_SERVER_URL);
const __dirname = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url));
export const desktopDir = NodePath.resolve(__dirname, "..");
const repoRoot = NodePath.resolve(desktopDir, "..", "..");
const devBundleIdSuffix = NodePath.basename(repoRoot)
  .toLowerCase()
  .replaceAll(/[^a-z0-9]+/g, "");
const APP_DISPLAY_NAME = isDevelopment ? "Boops (Dev)" : "Boops (Beta)";
const APP_BUNDLE_ID = isDevelopment
  ? `com.getboops.desktop.dev.${devBundleIdSuffix || "local"}`
  : "com.getboops.desktop";
const APP_PROTOCOL_SCHEMES = isDevelopment ? ["boops-dev"] : ["boops"];
const LAUNCHER_VERSION = 21;
const developmentMacIconPngPath = NodePath.join(
  repoRoot,
  "assets",
  "dev",
  "blueprint-macos-1024.png",
);
const productionMacIconPngPath = NodePath.join(repoRoot, "assets", "prod", "black-macos-1024.png");
const developmentIconComposerPath = NodePath.join(repoRoot, "assets", "dev", "app-icon.icon");
const productionIconComposerPath = NodePath.join(repoRoot, "assets", "prod", "app-icon.icon");
// oxlint-disable-next-line t3code/no-global-process-runtime -- Standalone launcher script has no Effect runtime.
const hostPlatform = NodeOS.platform();

function setPlistString(plistPath, key, value) {
  const replaceResult = NodeChildProcess.spawnSync(
    "plutil",
    ["-replace", key, "-string", value, plistPath],
    {
      encoding: "utf8",
    },
  );
  if (replaceResult.status === 0) {
    return;
  }

  const insertResult = NodeChildProcess.spawnSync(
    "plutil",
    ["-insert", key, "-string", value, plistPath],
    {
      encoding: "utf8",
    },
  );
  if (insertResult.status === 0) {
    return;
  }

  const details = [replaceResult.stderr, insertResult.stderr].filter(Boolean).join("\n");
  throw new Error(`Failed to update plist key "${key}" at ${plistPath}: ${details}`.trim());
}

function setPlistJson(plistPath, key, value) {
  const serialized = JSON.stringify(value);
  const replaceResult = NodeChildProcess.spawnSync(
    "plutil",
    ["-replace", key, "-json", serialized, plistPath],
    {
      encoding: "utf8",
    },
  );
  if (replaceResult.status === 0) {
    return;
  }

  const insertResult = NodeChildProcess.spawnSync(
    "plutil",
    ["-insert", key, "-json", serialized, plistPath],
    {
      encoding: "utf8",
    },
  );
  if (insertResult.status === 0) {
    return;
  }

  const details = [replaceResult.stderr, insertResult.stderr].filter(Boolean).join("\n");
  throw new Error(`Failed to update plist key "${key}" at ${plistPath}: ${details}`.trim());
}

function runChecked(command, args) {
  const result = NodeChildProcess.spawnSync(command, args, { encoding: "utf8" });
  if (result.status === 0) {
    return;
  }

  const details = [result.stdout, result.stderr].filter(Boolean).join("\n");
  throw new Error(`Failed to run ${command} ${args.join(" ")}: ${details}`.trim());
}

function resolveMacCodeSignArguments(appBundlePath) {
  return ["--force", "--deep", "--sign", "-", "--timestamp=none", appBundlePath];
}

function signMacLauncherBundle(appBundlePath) {
  runChecked("codesign", resolveMacCodeSignArguments(appBundlePath));
}

function shellSingleQuote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function makeDevelopmentEnvironmentScript(environment) {
  const envEntries = [
    ["VITE_DEV_SERVER_URL", environment.VITE_DEV_SERVER_URL],
    ["T3CODE_PORT", environment.T3CODE_PORT],
    ["T3CODE_HOME", environment.T3CODE_HOME],
    ["T3CODE_COMMIT_HASH", environment.T3CODE_COMMIT_HASH],
    ["T3CODE_OTLP_TRACES_URL", environment.T3CODE_OTLP_TRACES_URL],
    ["T3CODE_OTLP_EXPORT_INTERVAL_MS", environment.T3CODE_OTLP_EXPORT_INTERVAL_MS],
    ["T3CODE_OTLP_HEADERS", environment.T3CODE_OTLP_HEADERS],
    ["T3CODE_OTLP_PROTOCOL", environment.T3CODE_OTLP_PROTOCOL],
    ["T3CODE_DESKTOP_APP_USER_MODEL_ID", APP_BUNDLE_ID],
  ].filter((entry) => typeof entry[1] === "string" && entry[1].trim().length > 0);
  return [
    ...envEntries.map(
      ([name, value]) =>
        `if [ -z "\${${name}:-}" ]; then export ${name}=${shellSingleQuote(value)}; fi`,
    ),
    "",
  ].join("\n");
}

export function makeDevelopmentLauncherScript({
  electronBinaryPath,
  mainEntryPath,
  desktopRoot,
  environmentFilePath,
}) {
  return [
    "#!/bin/sh",
    `if [ -f ${shellSingleQuote(environmentFilePath)} ]; then . ${shellSingleQuote(environmentFilePath)}; fi`,
    `exec ${shellSingleQuote(electronBinaryPath)} --t3code-dev-root=${shellSingleQuote(desktopRoot)} ${shellSingleQuote(mainEntryPath)} "$@"`,
    "",
  ].join("\n");
}

const developmentEnvironmentFilePath = NodePath.join(
  desktopDir,
  ".electron-runtime",
  "dev-environment.sh",
);

function writeDevelopmentEnvironmentScript() {
  NodeFS.mkdirSync(NodePath.dirname(developmentEnvironmentFilePath), { recursive: true });
  NodeFS.writeFileSync(
    developmentEnvironmentFilePath,
    makeDevelopmentEnvironmentScript(process.env),
  );
}

export function writeDevelopmentLauncherScript(targetBinaryPath, electronBinaryPath) {
  const script = makeDevelopmentLauncherScript({
    electronBinaryPath,
    mainEntryPath: NodePath.join(desktopDir, "dist-electron", "main.cjs"),
    desktopRoot: desktopDir,
    environmentFilePath: developmentEnvironmentFilePath,
  });
  if (
    NodeFS.existsSync(targetBinaryPath) &&
    NodeFS.readFileSync(targetBinaryPath, "utf8") === script
  ) {
    NodeFS.chmodSync(targetBinaryPath, 0o755);
    return false;
  }
  NodeFS.writeFileSync(targetBinaryPath, script);
  NodeFS.chmodSync(targetBinaryPath, 0o755);
  return true;
}

function registerMacLauncherBundle(appBundlePath) {
  runChecked(
    "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister",
    ["-f", appBundlePath],
  );

  if (!isDevelopment) {
    return;
  }

  for (const scheme of APP_PROTOCOL_SCHEMES) {
    runChecked("osascript", [
      "-l",
      "JavaScript",
      "-e",
      [
        'ObjC.import("CoreServices");',
        `const scheme = $.NSString.alloc.initWithUTF8String(${JSON.stringify(scheme)});`,
        `const bundle = $.NSString.alloc.initWithUTF8String(${JSON.stringify(APP_BUNDLE_ID)});`,
        "const status = $.LSSetDefaultHandlerForURLScheme(scheme, bundle);",
        "if (status !== 0) throw new Error(`LSSetDefaultHandlerForURLScheme failed: ${status}`);",
      ].join(" "),
    ]);
  }
}

// Bundle-internal paths are macOS paths whatever host builds them.
function resolveMacLauncherIconPaths(runtimeDir, development = isDevelopment) {
  return {
    sourceIconPath: development ? developmentMacIconPngPath : productionMacIconPngPath,
    generatedIconPath: NodePath.posix.join(
      runtimeDir,
      development ? "icon-dev.icns" : "icon-prod.icns",
    ),
  };
}

function ensureMacIconIcns(runtimeDir) {
  const { sourceIconPath, generatedIconPath } = resolveMacLauncherIconPaths(runtimeDir);
  NodeFS.mkdirSync(runtimeDir, { recursive: true });

  if (!NodeFS.existsSync(sourceIconPath)) {
    throw new Error(`Desktop macOS icon source is missing at ${sourceIconPath}`);
  }

  const sourceMtimeMs = NodeFS.statSync(sourceIconPath).mtimeMs;
  if (
    NodeFS.existsSync(generatedIconPath) &&
    NodeFS.statSync(generatedIconPath).mtimeMs >= sourceMtimeMs
  ) {
    return generatedIconPath;
  }

  const iconsetRoot = NodeFS.mkdtempSync(NodePath.join(runtimeDir, "dev-iconset-"));
  const iconsetDir = NodePath.join(iconsetRoot, "icon.iconset");
  NodeFS.mkdirSync(iconsetDir, { recursive: true });

  try {
    for (const size of [16, 32, 128, 256, 512]) {
      runChecked("sips", [
        "-z",
        String(size),
        String(size),
        sourceIconPath,
        "--out",
        NodePath.join(iconsetDir, `icon_${size}x${size}.png`),
      ]);

      const retinaSize = size * 2;
      runChecked("sips", [
        "-z",
        String(retinaSize),
        String(retinaSize),
        sourceIconPath,
        "--out",
        NodePath.join(iconsetDir, `icon_${size}x${size}@2x.png`),
      ]);
    }

    runChecked("iconutil", ["-c", "icns", iconsetDir, "-o", generatedIconPath]);
    return generatedIconPath;
  } finally {
    NodeFS.rmSync(iconsetRoot, { recursive: true, force: true });
  }
}

function latestMtimeMs(path) {
  const stat = NodeFS.statSync(path);
  if (!stat.isDirectory()) {
    return stat.mtimeMs;
  }
  return NodeFS.readdirSync(path).reduce(
    (latest, entry) => Math.max(latest, latestMtimeMs(NodePath.join(path, entry))),
    stat.mtimeMs,
  );
}

// macOS 26 draws Liquid Glass only from a compiled Icon Composer catalog; the .icns stays as the older-macOS fallback.
function ensureMacAssetCatalog(runtimeDir) {
  const sourcePath = isDevelopment ? developmentIconComposerPath : productionIconComposerPath;
  const catalogDir = NodePath.join(
    runtimeDir,
    isDevelopment ? "icon-dev-catalog" : "icon-prod-catalog",
  );
  const catalogPath = NodePath.join(catalogDir, "Assets.car");
  if (
    NodeFS.existsSync(catalogPath) &&
    NodeFS.statSync(catalogPath).mtimeMs >= latestMtimeMs(sourcePath)
  ) {
    return catalogPath;
  }

  const workDir = NodeFS.mkdtempSync(NodePath.join(runtimeDir, "icon-catalog-"));
  try {
    // actool names the app icon after the .icon bundle, so it must be Icon.icon to match CFBundleIconName.
    const iconPath = NodePath.join(workDir, "Icon.icon");
    NodeFS.cpSync(sourcePath, iconPath, { recursive: true });
    runChecked("xcrun", [
      "actool",
      iconPath,
      "--compile",
      workDir,
      "--output-partial-info-plist",
      NodePath.join(workDir, "partial.plist"),
      "--app-icon",
      "Icon",
      "--include-all-app-icons",
      "--target-device",
      "mac",
      "--minimum-deployment-target",
      "26.0",
      "--platform",
      "macosx",
    ]);
    NodeFS.mkdirSync(catalogDir, { recursive: true });
    NodeFS.copyFileSync(NodePath.join(workDir, "Assets.car"), catalogPath);
    return catalogPath;
  } catch (error) {
    console.warn(
      `[electron-launcher] Icon Composer catalog skipped, using the flat icon (needs Xcode 26+): ${error.message}`,
    );
    return null;
  } finally {
    NodeFS.rmSync(workDir, { recursive: true, force: true });
  }
}

function resolveMacBundleInfoPlistStrings(executableName) {
  return {
    CFBundleDisplayName: APP_DISPLAY_NAME,
    CFBundleName: APP_DISPLAY_NAME,
    CFBundleIdentifier: APP_BUNDLE_ID,
    CFBundleExecutable: executableName,
    CFBundleIconFile: "icon.icns",
    NSScreenCaptureUsageDescription:
      "Boops captures the active window when you use the snapshot shortcut.",
    NSDocumentsFolderUsageDescription: "Boops reads project files you open in the desktop app.",
  };
}

function patchMainBundleInfoPlist(appBundlePath, iconPath, assetCatalogPath, executableName) {
  const infoPlistPath = NodePath.join(appBundlePath, "Contents", "Info.plist");
  for (const [key, value] of Object.entries(resolveMacBundleInfoPlistStrings(executableName))) {
    setPlistString(infoPlistPath, key, value);
  }
  // macOS 26 offers Messages/Mail codes in every text field unless opted out.
  setPlistJson(infoPlistPath, "NSAutoFillRequiresTextContentTypeForOneTimeCodeOnMac", true);
  setPlistJson(infoPlistPath, "CFBundleURLTypes", [
    {
      CFBundleURLName: APP_BUNDLE_ID,
      CFBundleURLSchemes: APP_PROTOCOL_SCHEMES,
    },
  ]);

  const resourcesDir = NodePath.join(appBundlePath, "Contents", "Resources");
  NodeFS.copyFileSync(iconPath, NodePath.join(resourcesDir, "icon.icns"));
  NodeFS.copyFileSync(iconPath, NodePath.join(resourcesDir, "electron.icns"));
  if (assetCatalogPath) {
    NodeFS.copyFileSync(assetCatalogPath, NodePath.join(resourcesDir, "Assets.car"));
    setPlistString(infoPlistPath, "CFBundleIconName", "Icon");
  }
}

function patchHelperBundleInfoPlists(appBundlePath) {
  const helperBundleNames = [
    ["Electron Helper.app", "helper", `${APP_DISPLAY_NAME} Helper`],
    ["Electron Helper (GPU).app", "helper.gpu", `${APP_DISPLAY_NAME} Helper (GPU)`],
    ["Electron Helper (Plugin).app", "helper.plugin", `${APP_DISPLAY_NAME} Helper (Plugin)`],
    ["Electron Helper (Renderer).app", "helper.renderer", `${APP_DISPLAY_NAME} Helper (Renderer)`],
  ];

  for (const [bundleName, bundleIdentifierSuffix, bundleDisplayName] of helperBundleNames) {
    const infoPlistPath = NodePath.join(
      appBundlePath,
      "Contents",
      "Frameworks",
      bundleName,
      "Contents",
      "Info.plist",
    );
    if (!NodeFS.existsSync(infoPlistPath)) {
      continue;
    }

    setPlistString(infoPlistPath, "CFBundleDisplayName", bundleDisplayName);
    setPlistString(infoPlistPath, "CFBundleName", bundleDisplayName);
    setPlistString(
      infoPlistPath,
      "CFBundleIdentifier",
      `${APP_BUNDLE_ID}.${bundleIdentifierSuffix}`,
    );
  }
}

function readJson(path) {
  try {
    return JSON.parse(NodeFS.readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

export function resolveMacLauncherPaths(appBundlePath, displayName = APP_DISPLAY_NAME) {
  const executableDir = NodePath.posix.join(appBundlePath, "Contents", "MacOS");
  const launcherExecutableName = `${displayName} Launcher`;
  return {
    launcherExecutableName,
    launcherBinaryPath: NodePath.posix.join(executableDir, launcherExecutableName),
    runtimeElectronBinaryPath: NodePath.posix.join(executableDir, "Electron"),
  };
}

function buildMacLauncher(electronBinaryPath) {
  const sourceAppBundlePath = NodePath.resolve(NodePath.dirname(electronBinaryPath), "../..");
  const runtimeDir = NodePath.join(desktopDir, ".electron-runtime");
  const targetAppBundlePath = NodePath.join(runtimeDir, `${APP_DISPLAY_NAME}.app`);
  const developmentPaths = resolveMacLauncherPaths(targetAppBundlePath);
  const runtimeElectronBinaryPath = developmentPaths.runtimeElectronBinaryPath;
  const launcherBinaryPath = isDevelopment
    ? developmentPaths.launcherBinaryPath
    : runtimeElectronBinaryPath;
  const iconPath = ensureMacIconIcns(runtimeDir);
  const assetCatalogPath = ensureMacAssetCatalog(runtimeDir);
  const metadataPath = NodePath.join(runtimeDir, "metadata.json");

  NodeFS.mkdirSync(runtimeDir, { recursive: true });

  const expectedMetadata = {
    launcherVersion: LAUNCHER_VERSION,
    sourceAppBundlePath,
    sourceAppMtimeMs: NodeFS.statSync(sourceAppBundlePath).mtimeMs,
    iconMtimeMs: NodeFS.statSync(iconPath).mtimeMs,
    assetCatalogMtimeMs: assetCatalogPath ? NodeFS.statSync(assetCatalogPath).mtimeMs : null,
    appBundleId: APP_BUNDLE_ID,
    appProtocolSchemes: APP_PROTOCOL_SCHEMES,
  };

  const currentMetadata = readJson(metadataPath);
  if (
    NodeFS.existsSync(launcherBinaryPath) &&
    (!isDevelopment || NodeFS.existsSync(runtimeElectronBinaryPath)) &&
    currentMetadata &&
    JSON.stringify(currentMetadata) === JSON.stringify(expectedMetadata)
  ) {
    if (isDevelopment) {
      // Protocol activations bypass the dev runner, so refresh the fallback environment on every launch.
      writeDevelopmentEnvironmentScript();
      if (writeDevelopmentLauncherScript(launcherBinaryPath, runtimeElectronBinaryPath)) {
        signMacLauncherBundle(targetAppBundlePath);
      }
    }
    registerMacLauncherBundle(targetAppBundlePath);
    return launcherBinaryPath;
  }

  NodeFS.rmSync(targetAppBundlePath, { recursive: true, force: true });
  // Without verbatimSymlinks, cpSync makes framework symlinks point outside the bundle and crashes helpers.
  NodeFS.cpSync(sourceAppBundlePath, targetAppBundlePath, {
    recursive: true,
    verbatimSymlinks: true,
  });
  patchMainBundleInfoPlist(
    targetAppBundlePath,
    iconPath,
    assetCatalogPath,
    isDevelopment ? developmentPaths.launcherExecutableName : "Electron",
  );
  patchHelperBundleInfoPlists(targetAppBundlePath);
  if (isDevelopment) {
    // Electron.app's executable name keeps default-app mode active without making app.isPackaged true.
    writeDevelopmentEnvironmentScript();
    writeDevelopmentLauncherScript(launcherBinaryPath, runtimeElectronBinaryPath);
  }
  signMacLauncherBundle(targetAppBundlePath);
  NodeFS.writeFileSync(metadataPath, `${JSON.stringify(expectedMetadata, null, 2)}\n`);
  registerMacLauncherBundle(targetAppBundlePath);

  return launcherBinaryPath;
}

function isLinuxSetuidSandboxConfigured(electronBinaryPath) {
  if (hostPlatform !== "linux") {
    return true;
  }

  const sandboxPath = NodePath.join(NodePath.dirname(electronBinaryPath), "chrome-sandbox");
  try {
    const sandboxStat = NodeFS.statSync(sandboxPath);
    return sandboxStat.uid === 0 && (sandboxStat.mode & 0o4777) === 0o4755;
  } catch {
    return false;
  }
}

function resolveLinuxSandboxArgs(electronBinaryPath) {
  if (isLinuxSetuidSandboxConfigured(electronBinaryPath)) {
    return [];
  }

  console.warn(
    "[desktop-launcher] Electron chrome-sandbox is not root-owned with mode 4755; launching local Electron with --no-sandbox.",
  );
  return ["--no-sandbox"];
}

function resolveElectronPath() {
  const electronBinaryPath = resolveElectronBinaryPath();

  if (hostPlatform !== "darwin") {
    return electronBinaryPath;
  }

  return buildMacLauncher(electronBinaryPath);
}

export function resolveElectronLaunchCommand(args = []) {
  const electronPath = resolveElectronPath();
  return {
    electronPath,
    args: [...resolveLinuxSandboxArgs(electronPath), ...args],
  };
}

export function resolveElectronBinaryPath({
  ensureRuntime = ensureElectronRuntime,
  createRequire = NodeModule.createRequire,
  moduleUrl = import.meta.url,
} = {}) {
  ensureRuntime();

  const require = createRequire(moduleUrl);
  return require("electron");
}

export function resolveDevProtocolClient() {
  if (hostPlatform !== "darwin" || !isDevelopment) {
    return null;
  }

  const electronBinaryPath = resolveElectronBinaryPath();
  const launcherBinaryPath = buildMacLauncher(electronBinaryPath);
  return {
    appBundlePath: NodePath.resolve(launcherBinaryPath, "..", "..", ".."),
    appBundleId: APP_BUNDLE_ID,
  };
}

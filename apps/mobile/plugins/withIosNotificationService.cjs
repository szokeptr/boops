"use strict";

// Adds the Notification Service Extension that opens sealed bot reply previews and shows the bot
// as the sender (plugins/notification-service/NotificationService.swift). The main app's
// communication entitlement, NSUserActivityTypes and shared keychain group live in app.config.ts.

const fs = require("fs");
const path = require("path");
const { IOSConfig, withDangerousMod, withXcodeProject } = require("expo/config-plugins");

const TARGET_NAME = "BoopsNotificationService";
const SWIFT_FILE = "NotificationService.swift";
const EMBED_PHASE = "Embed Foundation Extensions";
const SOURCE = path.join(__dirname, "notification-service", SWIFT_FILE);

function xmlEscape(value) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function plist(body) {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    "<dict>",
    ...body,
    "</dict>",
    "</plist>",
    "",
  ].join("\n");
}

const entry = (key, value) => [`  <key>${key}</key>`, `  <string>${xmlEscape(value)}</string>`];

function infoPlist({ appGroupId }) {
  return plist([
    ...entry("CFBundleDevelopmentRegion", "$(DEVELOPMENT_LANGUAGE)"),
    ...entry("CFBundleDisplayName", "$(PRODUCT_NAME)"),
    ...entry("CFBundleExecutable", "$(EXECUTABLE_NAME)"),
    ...entry("CFBundleIdentifier", "$(PRODUCT_BUNDLE_IDENTIFIER)"),
    ...entry("CFBundleInfoDictionaryVersion", "6.0"),
    ...entry("CFBundleName", "$(PRODUCT_NAME)"),
    ...entry("CFBundlePackageType", "$(PRODUCT_BUNDLE_PACKAGE_TYPE)"),
    // Build settings, so `xcodebuild CURRENT_PROJECT_VERSION=N` keeps it equal to the app's.
    ...entry("CFBundleShortVersionString", "$(MARKETING_VERSION)"),
    ...entry("CFBundleVersion", "$(CURRENT_PROJECT_VERSION)"),
    ...entry("BoopsAppGroup", appGroupId),
    "  <key>NSExtension</key>",
    "  <dict>",
    "    <key>NSExtensionPointIdentifier</key>",
    "    <string>com.apple.usernotifications.service</string>",
    "    <key>NSExtensionPrincipalClass</key>",
    "    <string>$(PRODUCT_MODULE_NAME).NotificationService</string>",
    "  </dict>",
  ]);
}

function entitlements({ appGroupId, keychainAccessGroup }) {
  return plist([
    "  <key>com.apple.security.application-groups</key>",
    "  <array>",
    `    <string>${xmlEscape(appGroupId)}</string>`,
    "  </array>",
    "  <key>keychain-access-groups</key>",
    "  <array>",
    `    <string>$(AppIdentifierPrefix)${xmlEscape(keychainAccessGroup)}</string>`,
    "  </array>",
  ]);
}

function withExtensionFiles(config, props) {
  return withDangerousMod(config, [
    "ios",
    (cfg) => {
      const directory = path.join(cfg.modRequest.platformProjectRoot, TARGET_NAME);
      fs.mkdirSync(directory, { recursive: true });
      fs.copyFileSync(SOURCE, path.join(directory, SWIFT_FILE));
      fs.writeFileSync(path.join(directory, "Info.plist"), infoPlist(props));
      fs.writeFileSync(path.join(directory, `${TARGET_NAME}.entitlements`), entitlements(props));
      return cfg;
    },
  ]);
}

function addFileReference(project, filePath, fileType) {
  const uuid = project.generateUuid();
  const references = project.pbxFileReferenceSection();
  references[uuid] = {
    isa: "PBXFileReference",
    lastKnownFileType: fileType,
    path: filePath,
    sourceTree: '"<group>"',
  };
  references[`${uuid}_comment`] = filePath;
  return uuid;
}

function findEmbedPhase(project, mainTarget) {
  const phases = project.hash.project.objects.PBXCopyFilesBuildPhase ?? {};
  for (const phase of mainTarget.buildPhases ?? []) {
    const object = phases[phase.value];
    if (phase.comment === EMBED_PHASE && object && Number(object.dstSubfolderSpec) === 13) {
      return object;
    }
  }
  return null;
}

/**
 * Idempotent: a target that already exists is left alone, like expo-widgets'. Own file references
 * throughout, since Xcode rejects one reference shared between groups (every target has an
 * Info.plist).
 */
function addNotificationServiceTarget(project, options) {
  if (project.pbxTargetByName(TARGET_NAME)) return false;
  const objects = project.hash.project.objects;
  const mainTarget = IOSConfig.XcodeUtils.getApplicationNativeTarget({
    project,
    projectName: options.projectName,
  });

  const buildSettings = {
    APPLICATION_EXTENSION_API_ONLY: "YES",
    CODE_SIGN_ENTITLEMENTS: `"${TARGET_NAME}/${TARGET_NAME}.entitlements"`,
    CODE_SIGN_STYLE: "Automatic",
    CURRENT_PROJECT_VERSION: `"${options.buildNumber}"`,
    ...(options.appleTeamId ? { DEVELOPMENT_TEAM: options.appleTeamId } : {}),
    GENERATE_INFOPLIST_FILE: "NO",
    INFOPLIST_FILE: `"${TARGET_NAME}/Info.plist"`,
    IPHONEOS_DEPLOYMENT_TARGET: `"${options.deploymentTarget}"`,
    LD_RUNPATH_SEARCH_PATHS: [
      '"$(inherited)"',
      '"@executable_path/Frameworks"',
      '"@executable_path/../../Frameworks"',
    ],
    MARKETING_VERSION: `"${options.marketingVersion}"`,
    PRODUCT_BUNDLE_IDENTIFIER: `"${options.bundleIdentifier}"`,
    PRODUCT_NAME: '"$(TARGET_NAME)"',
    SKIP_INSTALL: "YES",
    SWIFT_VERSION: "5.0",
    TARGETED_DEVICE_FAMILY: '"1,2"',
  };
  const configurationList = project.addXCConfigurationList(
    [
      {
        name: "Debug",
        isa: "XCBuildConfiguration",
        buildSettings: {
          ...buildSettings,
          DEBUG_INFORMATION_FORMAT: "dwarf",
          SWIFT_ACTIVE_COMPILATION_CONDITIONS: '"DEBUG $(inherited)"',
          SWIFT_OPTIMIZATION_LEVEL: '"-Onone"',
        },
      },
      {
        name: "Release",
        isa: "XCBuildConfiguration",
        buildSettings: {
          ...buildSettings,
          DEBUG_INFORMATION_FORMAT: '"dwarf-with-dsym"',
          SWIFT_COMPILATION_MODE: "wholemodule",
        },
      },
    ],
    "Release",
    `Build configuration list for PBXNativeTarget "${TARGET_NAME}"`,
  );

  // node-xcode appends `.appex` for this file type itself.
  const productFile = project.addProductFile(TARGET_NAME, {
    group: EMBED_PHASE,
    explicitFileType: "wrapper.app-extension",
    settings: { ATTRIBUTES: ["RemoveHeadersOnCopy"] },
    includeInIndex: 0,
    sourceTree: "BUILT_PRODUCTS_DIR",
  });

  const targetUuid = project.generateUuid();
  const target = {
    uuid: targetUuid,
    pbxNativeTarget: {
      isa: "PBXNativeTarget",
      name: TARGET_NAME,
      productName: TARGET_NAME,
      productReference: productFile.fileRef,
      productType: '"com.apple.product-type.app-extension"',
      buildConfigurationList: configurationList.uuid,
      buildPhases: [],
      buildRules: [],
      dependencies: [],
    },
  };
  project.addToPbxNativeTargetSection(target);
  project.addToPbxProjectSection(target);
  const projectObject = project.pbxProjectSection()[project.getFirstProject().uuid];
  projectObject.attributes.TargetAttributes ??= {};
  projectObject.attributes.TargetAttributes[targetUuid] = {
    CreatedOnToolsVersion: "16.0",
    ...(options.appleTeamId ? { DevelopmentTeam: options.appleTeamId } : {}),
  };

  objects.PBXTargetDependency ??= {};
  objects.PBXContainerItemProxy ??= {};
  project.addTargetDependency(mainTarget.uuid, [targetUuid]);

  const swiftRef = addFileReference(project, SWIFT_FILE, "sourcecode.swift");
  const infoPlistRef = addFileReference(project, "Info.plist", "text.plist.xml");
  const entitlementsRef = addFileReference(
    project,
    `${TARGET_NAME}.entitlements`,
    "text.plist.entitlements",
  );
  const swiftBuildFile = project.generateUuid();
  objects.PBXBuildFile[swiftBuildFile] = {
    isa: "PBXBuildFile",
    fileRef: swiftRef,
    fileRef_comment: SWIFT_FILE,
  };
  objects.PBXBuildFile[`${swiftBuildFile}_comment`] = `${SWIFT_FILE} in Sources`;

  const sources = project.addBuildPhase([], "PBXSourcesBuildPhase", "Sources", targetUuid);
  sources.buildPhase.files.push({ value: swiftBuildFile, comment: `${SWIFT_FILE} in Sources` });
  project.addBuildPhase([], "PBXFrameworksBuildPhase", "Frameworks", targetUuid);
  project.addBuildPhase([], "PBXResourcesBuildPhase", "Resources", targetUuid);

  const groupUuid = project.generateUuid();
  objects.PBXGroup[groupUuid] = {
    isa: "PBXGroup",
    children: [
      { value: swiftRef, comment: SWIFT_FILE },
      { value: infoPlistRef, comment: "Info.plist" },
      { value: entitlementsRef, comment: `${TARGET_NAME}.entitlements` },
    ],
    path: TARGET_NAME,
    sourceTree: '"<group>"',
  };
  objects.PBXGroup[`${groupUuid}_comment`] = TARGET_NAME;
  const mainGroup = objects.PBXGroup[project.getFirstProject().firstProject.mainGroup];
  mainGroup.children.push({ value: groupUuid, comment: TARGET_NAME });

  let embed = findEmbedPhase(project, mainTarget.target);
  if (!embed) {
    embed = project.addBuildPhase(
      [],
      "PBXCopyFilesBuildPhase",
      EMBED_PHASE,
      mainTarget.uuid,
      "app_extension",
      '""',
    ).buildPhase;
  }
  project.addToPbxBuildFileSection(productFile);
  embed.files.push({
    value: productFile.uuid,
    comment: `${productFile.basename} in ${EMBED_PHASE}`,
  });
  return true;
}

function withExtensionTarget(config, props) {
  return withXcodeProject(config, (cfg) => {
    addNotificationServiceTarget(cfg.modResults, {
      projectName: cfg.modRequest.projectName,
      bundleIdentifier: props.bundleIdentifier,
      deploymentTarget: props.deploymentTarget,
      appleTeamId: cfg.ios?.appleTeamId,
      buildNumber: cfg.ios?.buildNumber ?? "1",
      marketingVersion: cfg.ios?.version ?? cfg.version ?? "1.0",
    });
    return cfg;
  });
}

/**
 * @param {import('expo/config').ExpoConfig} config
 * @param {{ bundleIdentifier: string, appGroupId: string, keychainAccessGroup: string, deploymentTarget: string }} props
 */
module.exports = function withIosNotificationService(config, props) {
  return withExtensionTarget(withExtensionFiles(config, props), props);
};

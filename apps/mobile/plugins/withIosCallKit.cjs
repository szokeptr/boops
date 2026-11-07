const { IOSConfig, withXcodeProject } = require("expo/config-plugins");

// react-native-callkeep's pod does not declare CallKit; the app links it for bot calls. Its
// Android ConnectionService stays out (react-native.config.js), so this replaces its config plugin.
module.exports = function withIosCallKit(config) {
  return withXcodeProject(config, (config) => {
    const target = IOSConfig.XcodeUtils.getApplicationNativeTarget({
      project: config.modResults,
      projectName: config.modRequest.projectName,
    });
    config.modResults.addFramework("CallKit.framework", { target: target.uuid });
    return config;
  });
};

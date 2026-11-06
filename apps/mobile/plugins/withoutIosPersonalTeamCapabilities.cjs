const { withEntitlementsPlist } = require("expo/config-plugins");

module.exports = function withoutIosPersonalTeamCapabilities(config) {
  return withEntitlementsPlist(config, (modConfig) => {
    delete modConfig.modResults["aps-environment"];
    delete modConfig.modResults["com.apple.developer.applesignin"];
    delete modConfig.modResults["com.apple.security.application-groups"];
    // The domains belong to T3's team, so they can never verify for a personal bundle id.
    delete modConfig.modResults["com.apple.developer.associated-domains"];
    return modConfig;
  });
};

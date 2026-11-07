// Bot calls use CallKit on iOS only. On Android the library's ConnectionService and its phone
// permissions (CALL_PHONE, READ_PHONE_NUMBERS) would ship unused, so it is not linked there.
module.exports = {
  dependencies: {
    "react-native-callkeep": { platforms: { android: null } },
  },
};

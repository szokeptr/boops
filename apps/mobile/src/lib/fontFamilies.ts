import { Platform } from "react-native";

/** Matches `--font-sans` in global.css; weights come from `fontWeight`. */
export const SYSTEM_FONT_FAMILY = Platform.OS === "ios" ? "System" : "sans-serif";

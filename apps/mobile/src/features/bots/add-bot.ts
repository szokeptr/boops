import type { NavigationProp, ParamListBase } from "@react-navigation/native";

/** Opens the add-project flow until bots get their own creation screen. */
export function openAddBot(navigation: Pick<NavigationProp<ParamListBase>, "navigate">) {
  navigation.navigate("AddProject");
}

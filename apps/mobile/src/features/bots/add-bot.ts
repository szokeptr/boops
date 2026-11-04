import type { NavigationProp, ParamListBase } from "@react-navigation/native";

export function openAddBot(navigation: Pick<NavigationProp<ParamListBase>, "navigate">) {
  navigation.navigate("CreateBot");
}

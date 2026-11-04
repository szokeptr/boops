import type { ComponentProps } from "react";
import { FloatingActionButton } from "./ui/FloatingActionButton.android";
import { ScrollComposeButton } from "./ScrollComposeButton.android";
import type { AddBotButton as SharedAddBotButton } from "./AddBotButton.shared";

export function AddBotButton(props: ComponentProps<typeof SharedAddBotButton>) {
  if (props.extended && props.expanded !== undefined) {
    return <ScrollComposeButton {...props} expanded={props.expanded} />;
  }
  return (
    <FloatingActionButton
      {...props}
      icon="plus"
      label="Add bot"
      tone="primary"
      variant={props.extended ? "extended" : "large"}
    />
  );
}

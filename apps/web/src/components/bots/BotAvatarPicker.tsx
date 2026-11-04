import type { BotHatchStage } from "@t3tools/client-runtime/bot-avatar";
import { screeniePalette } from "@t3tools/client-runtime/bot-avatar";
import { BOT_AVATAR_ACCESSORIES, BOT_AVATAR_HUES, type ProjectAvatar } from "@t3tools/contracts";
import { familySpec, rerollSpec } from "@t3tools/shared/botAvatar";
import { DicesIcon } from "lucide-react";

import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";

import { BotAvatar } from "./BotAvatar";

export interface BotAvatarPickerProps {
  readonly name: string;
  /** Null previews the look the server would pick for this name, until the user changes it. */
  readonly value: ProjectAvatar | null;
  /** Looks of the user's other bots on this environment, which a reroll avoids. */
  readonly siblings: ReadonlyArray<ProjectAvatar>;
  readonly onChange: (avatar: ProjectAvatar) => void;
  readonly hatchStage?: BotHatchStage | undefined;
}

const label = (id: string) => id.charAt(0).toUpperCase() + id.slice(1);

const OPTION =
  "inline-flex cursor-pointer items-center justify-center rounded-md outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring aria-pressed:ring-2 aria-pressed:ring-inset aria-pressed:ring-foreground";

export function BotAvatarPicker({
  name,
  value,
  siblings,
  onChange,
  hatchStage,
}: BotAvatarPickerProps) {
  const current = value ?? familySpec(name, siblings);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <BotAvatar avatar={current} name={name} status="idle" size={64} hatchStage={hatchStage} />
        <Button variant="outline" size="sm" onClick={() => onChange(rerollSpec(current, siblings))}>
          <DicesIcon />
          Reroll
        </Button>
      </div>
      <div role="group" aria-label="Colour" className="flex flex-wrap gap-1.5">
        {BOT_AVATAR_HUES.map((hue) => (
          <button
            key={hue}
            type="button"
            aria-label={label(hue)}
            aria-pressed={current.hue === hue}
            className={cn(OPTION, "size-6")}
            style={{ backgroundColor: screeniePalette({ ...current, hue }).b }}
            onClick={() => onChange({ ...current, hue })}
          />
        ))}
      </div>
      <div role="group" aria-label="Accessory" className="flex flex-wrap gap-1.5">
        {BOT_AVATAR_ACCESSORIES.map((accessory) => (
          <button
            key={accessory}
            type="button"
            aria-label={label(accessory)}
            aria-pressed={current.accessory === accessory}
            className={cn(OPTION, "p-1")}
            onClick={() => onChange({ ...current, accessory })}
          >
            <BotAvatar avatar={{ ...current, accessory }} name={name} status="idle" size={32} />
          </button>
        ))}
      </div>
    </div>
  );
}

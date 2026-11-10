import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString } from "./baseSchemas.ts";

export const SidebarSectionId = TrimmedNonEmptyString.pipe(Schema.brand("SidebarSectionId"));
export type SidebarSectionId = typeof SidebarSectionId.Type;

export const SIDEBAR_SECTION_TITLE_MAX_LENGTH = 60;

export const SidebarSection = Schema.Struct({
  id: SidebarSectionId,
  title: TrimmedNonEmptyString.check(Schema.isMaxLength(SIDEBAR_SECTION_TITLE_MAX_LENGTH)),
  collapsed: Schema.Boolean,
  /**
   * `bot:<environmentId>:<projectId>` or `room:<environmentId>:<roomId>`, in the order shown.
   * Keys of bots or rooms this client cannot see stay, so a disconnected machine keeps its place.
   */
  items: Schema.Array(TrimmedNonEmptyString).check(Schema.isMaxLength(1_000)),
});
export type SidebarSection = typeof SidebarSection.Type;

/** One viewer's own sidebar sections, shared by all their clients. */
export const SidebarLayout = Schema.Struct({
  sections: Schema.Array(SidebarSection).check(Schema.isMaxLength(100)),
});
export type SidebarLayout = typeof SidebarLayout.Type;

export const EMPTY_SIDEBAR_LAYOUT: SidebarLayout = { sections: [] };

export const SidebarLayoutSetInput = Schema.Struct({ layout: SidebarLayout });
export type SidebarLayoutSetInput = typeof SidebarLayoutSetInput.Type;

export class SidebarLayoutError extends Schema.TaggedError<SidebarLayoutError>()(
  "SidebarLayoutError",
  { cause: Schema.optionalKey(Schema.Defect()) },
) {
  override get message(): string {
    return "Could not save the sidebar layout.";
  }
}

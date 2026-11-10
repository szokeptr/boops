import { createContext } from "react";

/** A group chat's bot names: markdown below marks each `@Name` that would ask that bot. */
export const MarkdownMentionNamesContext = createContext<ReadonlyArray<string>>([]);

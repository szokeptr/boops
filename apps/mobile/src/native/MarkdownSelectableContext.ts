import { createContext } from "react";

/** False where a long-press means something else, such as a bubble that opens reactions. */
export const MarkdownSelectableContext = createContext(true);

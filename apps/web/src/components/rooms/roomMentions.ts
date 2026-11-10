/**
 * The `@partial` right before the caret, while some bot's name starts with it: the query and
 * where its `@` sits. Names can have spaces, so the query runs on past them while it still
 * matches a name.
 */
export function roomMentionQuery(
  beforeCursor: string,
  names: ReadonlyArray<string>,
): { readonly query: string; readonly start: number } | null {
  const start = beforeCursor.lastIndexOf("@");
  if (start === -1) return null;
  if (start > 0 && !/\s/u.test(beforeCursor[start - 1]!)) return null;
  const query = beforeCursor.slice(start + 1);
  if (query.includes("\n")) return null;
  if (!/\s/u.test(query)) return /^[\p{L}\p{N}_-]*$/u.test(query) ? { query, start } : null;
  const lower = query.toLowerCase();
  return names.some((name) => name.toLowerCase().startsWith(lower)) ? { query, start } : null;
}

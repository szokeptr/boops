export type RichTextMark = "bold" | "italic" | "strike" | "code";

interface RichTextSpan {
  text: string;
  marks: RichTextMark[];
}

export const RICH_TEXT_DELIMITERS: Record<RichTextMark, string> = {
  bold: "**",
  italic: "*",
  strike: "~~",
  code: "`",
};

function pushSpan(spans: RichTextSpan[], text: string, marks: RichTextMark[]): void {
  if (!text) return;
  const last = spans[spans.length - 1];
  if (
    last &&
    last.marks.length === marks.length &&
    last.marks.every((mark, index) => mark === marks[index])
  ) {
    last.text += text;
  } else {
    spans.push({ text, marks });
  }
}

// Brackets, quotes, commas, and Markdown delimiters end a URL or path token; a lone `~` does not.
const PATH_TOKEN = /(?:[\p{L}\p{N}_/.:@%+=&?#-]|(?<!~)~(?!~))+/gu;
const FILE_EXTENSION = /^\.[a-z][a-z0-9]*(?::\d+){0,2}$/i;
// `_yes_/_no_`: each side of a slash is its own emphasis span, so the word is not a path.
const EMPHASIS_ALTERNATIVES = /^_[^/]+_(?:\/_[^/]+_)+$/;
// Word characters in any script; callers pass two code units so a letter outside the BMP matches whole.
const WORD_CHARACTER_BEFORE = /[\p{L}\p{M}\p{N}_]$/u;
const WORD_CHARACTER_AFTER = /^[\p{L}\p{M}\p{N}_]/u;

/**
 * Starts of underscore runs that belong to a URL, path, or filename, not to emphasis.
 * A run ending the token stays a delimiter so emphasis wrapped around the token still closes.
 */
function literalUnderscoreRuns(text: string): Set<number> {
  const literal = new Set<number>();
  if (!text.includes("_")) return literal;
  for (const match of text.matchAll(PATH_TOKEN)) {
    const token = match[0];
    let bodyEnd = token.length;
    while (bodyEnd > 0 && ".:?".includes(token[bodyEnd - 1]!)) bodyEnd -= 1;
    if (EMPHASIS_ALTERNATIVES.test(token.slice(0, bodyEnd))) continue;
    while (bodyEnd > 0 && token[bodyEnd - 1] === "_") bodyEnd -= 1;
    const body = token.slice(0, bodyEnd);
    // A slash alone is prose (`and/_or_`); a path also has a dot, a scheme or port, or a root.
    const isPath = body.includes("/")
      ? /^~?\/|[.:]/.test(body)
      : FILE_EXTENSION.test(body.slice(body.lastIndexOf(".")));
    if (!isPath) continue;
    let closesInside = false;
    let start = body.indexOf("_");
    while (start !== -1) {
      let end = start;
      while (body[end] === "_") end += 1;
      if (start > 0) {
        literal.add(match.index + start);
        closesInside ||= !WORD_CHARACTER_AFTER.test(body.slice(end, end + 2));
      }
      start = body.indexOf("_", end);
    }
    // A leading run could only pair with a run inside the name, as in `__init__.py`.
    if (closesInside && body[0] === "_") literal.add(match.index);
  }
  return literal;
}

export function parseInlineMarkdown(text: string): RichTextSpan[] {
  const literalRuns = literalUnderscoreRuns(text);
  const root: RichTextSpan[] = [];
  const stack: { delimiter: string; mark: RichTextMark; spans: RichTextSpan[] }[] = [];
  const current = () => stack.at(-1)?.spans ?? root;
  let index = 0;
  while (index < text.length) {
    const char = text[index]!;
    if (char === "\\") {
      pushSpan(current(), text.slice(index, index + 2), []);
      index += 2;
      continue;
    }
    if (char === "`") {
      const run = text.slice(index).match(/^`+/)![0];
      const close = text.indexOf(run, index + run.length);
      if (
        run.length === 1 &&
        close > index + 1 &&
        !text.slice(index, close).includes("\n") &&
        text[close + 1] !== "`"
      ) {
        pushSpan(current(), text.slice(index + 1, close), ["code"]);
        index = close + 1;
      } else {
        pushSpan(current(), run, []);
        index += run.length;
      }
      continue;
    }
    if (char !== "*" && char !== "_" && char !== "~") {
      pushSpan(current(), char, []);
      index += 1;
      continue;
    }
    let end = index;
    while (text[end] === char) end += 1;
    if (literalRuns.has(index)) {
      pushSpan(current(), text.slice(index, end), []);
      index = end;
      continue;
    }
    const before = text[index - 1] ?? "";
    const after = text[end] ?? "";
    const wordAfter = WORD_CHARACTER_AFTER.test(text.slice(end, end + 2));
    const wordBefore = WORD_CHARACTER_BEFORE.test(text.slice(Math.max(0, index - 2), index));
    const canClose = before !== "" && !/\s/.test(before) && (char !== "_" || !wordAfter);
    const canOpen = after !== "" && !/\s/.test(after) && (char !== "_" || !wordBefore);
    while (index < end) {
      const top = stack.at(-1);
      const opensNestedBold =
        top?.mark === "italic" &&
        end - index === 2 &&
        canOpen &&
        (char === "*" || char === "_") &&
        !stack.some((frame) => frame.mark === "bold");
      if (
        !opensNestedBold &&
        canClose &&
        top &&
        text.startsWith(top.delimiter, index) &&
        index + top.delimiter.length <= end
      ) {
        stack.pop();
        for (const span of top.spans) pushSpan(current(), span.text, [top.mark, ...span.marks]);
        index += top.delimiter.length;
      } else if (canOpen && (char !== "~" || end - index >= 2)) {
        const length = char === "~" || end - index >= 2 ? 2 : 1;
        const mark = char === "~" ? "strike" : length === 2 ? "bold" : "italic";
        // Prevent self-nesting, including alternate delimiters, to bound the stack by supported styles.
        if (stack.some((frame) => frame.mark === mark)) {
          pushSpan(current(), text.slice(index, end), []);
          index = end;
          continue;
        }
        stack.push({
          delimiter: char.repeat(length),
          mark,
          spans: [],
        });
        index += length;
      } else {
        pushSpan(current(), text.slice(index, end), []);
        index = end;
      }
    }
  }
  while (stack.length > 0) {
    const frame = stack.pop()!;
    pushSpan(current(), frame.delimiter, []);
    for (const span of frame.spans) pushSpan(current(), span.text, span.marks);
  }
  return root;
}

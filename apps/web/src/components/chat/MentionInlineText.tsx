import { Children, cloneElement, isValidElement, type ReactNode } from "react";

import { roomMentionSpans } from "@t3tools/contracts";

function MentionInlineText(props: { text: string; names: ReadonlyArray<string> }) {
  const spans = roomMentionSpans(props.text, props.names);
  if (spans.length === 0) return props.text;
  const nodes: ReactNode[] = [];
  let cursor = 0;
  for (const { start, end } of spans) {
    if (start > cursor) nodes.push(props.text.slice(cursor, start));
    nodes.push(
      <span key={start} className="font-semibold" data-mention="">
        {props.text.slice(start, end)}
      </span>,
    );
    cursor = end;
  }
  if (cursor < props.text.length) nodes.push(props.text.slice(cursor));
  return nodes;
}

/** Marks `@Name` mentions in rendered markdown text, leaving code and links alone. */
export function renderMentionMarkdownChildren(
  children: ReactNode,
  names: ReadonlyArray<string>,
): ReactNode {
  if (names.length === 0) return children;
  return Children.map(children, (child) => {
    if (typeof child === "string") return <MentionInlineText text={child} names={names} />;
    if (!isValidElement<{ children?: ReactNode; node?: { tagName?: string } }>(child)) {
      return child;
    }
    const markdownTagName = typeof child.type === "string" ? child.type : child.props.node?.tagName;
    if (markdownTagName === "code" || markdownTagName === "a" || !("children" in child.props)) {
      return child;
    }
    return cloneElement(
      child,
      undefined,
      renderMentionMarkdownChildren(child.props.children, names),
    );
  });
}

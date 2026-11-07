import {
  ASSISTANT_CITATION_MAX_TEXT_LENGTH,
  EnvironmentId,
  MessageId,
  ThreadId,
} from "@t3tools/contracts";
import { collectAssistantCitations } from "@t3tools/shared/assistantCitations";
import { describe, expect, it } from "vite-plus/test";

import {
  appendAssistantCitationToDraft,
  draftCitationAt,
  mobileAssistantCitation,
  removeDraftCitation,
  setDraftCitationComment,
} from "./composerCitation";

const source = {
  environmentId: EnvironmentId.make("env"),
  threadId: ThreadId.make("thread"),
  messageId: MessageId.make("message"),
};

describe("mobileAssistantCitation", () => {
  it.each([
    [
      "trims and normalizes line endings",
      " one\r\ntwo ",
      4,
      { text: "one\ntwo", start: 4, end: 11 },
    ],
    ["drops inline attachment markers", "see ￼ here", 0, { text: "see  here", start: 0, end: 9 }],
    ["blank selection", " \n￼ ", 0, null],
    ["too long to cite", "x".repeat(ASSISTANT_CITATION_MAX_TEXT_LENGTH + 1), 0, null],
  ])("%s", (_name, text, start, expected) => {
    const citation = mobileAssistantCitation({ ...source, text, start });
    expect(citation && { text: citation.text, start: citation.start, end: citation.end }).toEqual(
      expected,
    );
  });
});

describe("appendAssistantCitationToDraft", () => {
  it.each([
    ["empty draft", "", ""],
    ["draft ending in text", "Look", "Look "],
    ["draft ending in whitespace", "Look\n", "Look\n"],
  ])("%s", (_name, draft, head) => {
    const citation = mobileAssistantCitation({ ...source, text: "a (quoted) $skill", start: 2 })!;
    const { text: next, range } = appendAssistantCitationToDraft(draft, citation);
    const [match] = collectAssistantCitations(next);
    expect(next.slice(0, match!.start)).toBe(head);
    expect(next.slice(match!.end)).toBe(" ");
    expect(match!.citation).toEqual(citation);
    expect(range).toEqual({ source: match!.source, start: match!.start, end: match!.end });
  });
});

describe("draft citation edits", () => {
  const citation = mobileAssistantCitation({ ...source, text: "quoted", start: 0 })!;
  const { text: draft, range } = appendAssistantCitationToDraft("Hi", citation);

  it("sets, replaces, and clears the comment in place", () => {
    const commented = setDraftCitationComment(`${draft}tail`, range, "  why?  ")!;
    const [match] = collectAssistantCitations(commented);
    expect(match!.citation).toEqual({ ...citation, comment: "why?" });
    expect(commented.startsWith("Hi ")).toBe(true);
    expect(commented.endsWith(" tail")).toBe(true);

    const cleared = setDraftCitationComment(commented, { ...match!, source: match!.source }, " ");
    expect(cleared).toBe(`${draft}tail`);
    expect(draftCitationAt(cleared!, range)).toEqual(citation);
  });

  it("removes the citation with its trailing space", () => {
    expect(removeDraftCitation(`${draft}tail`, range)).toBe("Hi tail");
  });

  it("refuses a range the draft no longer holds", () => {
    const moved = `x${draft}`;
    expect(draftCitationAt(moved, range)).toBeNull();
    expect(setDraftCitationComment(moved, range, "why?")).toBeNull();
    expect(removeDraftCitation(moved, range)).toBeNull();
  });
});

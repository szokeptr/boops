import {
  ASSISTANT_CITATION_MAX_TEXT_LENGTH,
  type AssistantCitation,
  type EnvironmentId,
  type MessageId,
  type ThreadId,
} from "@t3tools/contracts";
import {
  collectAssistantCitations,
  serializeAssistantCitation,
  withAssistantCitationComment,
} from "@t3tools/shared/assistantCitations";

/**
 * Native selections only know the rendered text of one markdown segment, so offsets are
 * segment-local and the context is empty. Web resolves the source by text first.
 */
export function mobileAssistantCitation(input: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly messageId: MessageId;
  readonly text: string;
  readonly start: number;
}): AssistantCitation | null {
  // Native selections carry U+FFFC for inline images and attachments.
  const text = input.text.replace(/￼/g, "").replace(/\r\n?/g, "\n").trim();
  if (text.length === 0 || text.length > ASSISTANT_CITATION_MAX_TEXT_LENGTH) return null;
  const start = Math.max(0, Math.trunc(input.start));
  return {
    version: 1,
    environmentId: input.environmentId,
    threadId: input.threadId,
    messageId: input.messageId,
    text,
    start,
    end: start + text.length,
    prefix: "",
    suffix: "",
  };
}

export interface DraftCitationRange {
  readonly source: string;
  readonly start: number;
  readonly end: number;
}

export function appendAssistantCitationToDraft(
  draft: string,
  citation: AssistantCitation,
): { readonly text: string; readonly range: DraftCitationRange } {
  const separator = draft.length === 0 || /\s$/.test(draft) ? "" : " ";
  const source = serializeAssistantCitation(citation);
  const start = draft.length + separator.length;
  return {
    text: `${draft}${separator}${source} `,
    range: { source, start, end: start + source.length },
  };
}

/** Null when the draft no longer holds that citation where it was. */
export function draftCitationAt(draft: string, range: DraftCitationRange) {
  if (draft.slice(range.start, range.end) !== range.source) return null;
  return parseAssistantCitationLink(range.source);
}

/** Null when the draft no longer holds that citation where it was. */
export function setDraftCitationComment(
  draft: string,
  range: DraftCitationRange,
  comment: string,
): string | null {
  const citation = draftCitationAt(draft, range);
  if (!citation) return null;
  const source = serializeAssistantCitation(withAssistantCitationComment(citation, comment));
  return draft.slice(0, range.start) + source + draft.slice(range.end);
}

/** Removes the citation and the space after it, which appending added. */
export function removeDraftCitation(draft: string, range: DraftCitationRange): string | null {
  if (draft.slice(range.start, range.end) !== range.source) return null;
  const end = draft[range.end] === " " ? range.end + 1 : range.end;
  return draft.slice(0, range.start) + draft.slice(end);
}

function parseAssistantCitationLink(source: string): AssistantCitation | null {
  const [match] = collectAssistantCitations(source);
  return match && match.start === 0 && match.end === source.length ? match.citation : null;
}

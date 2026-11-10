import {
  type ComposerContextRecord,
  type EnvironmentId,
  roomMentionSpans,
  type ThreadId,
} from "@t3tools/contracts";
import {
  composerChipSizeSuffix,
  contextChipIcon,
  contextChipPresentation,
  contextRecordFileName,
  type ContextChipIconRef,
  UNAVAILABLE_CONTEXT_CHIP_PRESENTATION,
} from "./composerChipPresentation";
import type { SelectableMarkdownSkill } from "../native/SelectableMarkdownText.types";
import {
  formatComposerContextHref,
  parseComposerContextHref,
} from "@t3tools/shared/composerContextReferences";
import { hasThreadLinks, parseThreadLinkHref } from "@t3tools/shared/threadLinks";

export function enrichedContextLinkPresentation(
  href: string,
  records?: ReadonlyArray<ComposerContextRecord>,
): { accent?: string; icon: ContextChipIconRef; label?: string } | undefined {
  const reference = parseComposerContextHref(href);
  if (!reference) return undefined;
  const record = records?.find((candidate) => candidate.contextId === reference.contextId);
  const presentation =
    records && !record
      ? UNAVAILABLE_CONTEXT_CHIP_PRESENTATION
      : contextChipPresentation(reference.kind, record);
  const size = composerChipSizeSuffix(record);
  return {
    ...(presentation.accent ? { accent: presentation.accent } : {}),
    icon: contextChipIcon(presentation, contextRecordFileName(record)),
    ...(record && size ? { label: `${record.label} · ${size}` } : {}),
  };
}

export function enrichedThreadLinkPresentation(
  href: string,
): { accent?: string; icon: ContextChipIconRef } | undefined {
  if (!parseThreadLinkHref(href)) return undefined;
  const presentation = contextChipPresentation("thread");
  return {
    ...(presentation.accent ? { accent: presentation.accent } : {}),
    icon: contextChipIcon(presentation, ""),
  };
}

export interface ThreadChipTarget {
  readonly href: string;
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly link: boolean;
}

export function threadChipTargets(
  environmentId: EnvironmentId,
  markdown: string,
  records?: ReadonlyArray<ComposerContextRecord>,
): ReadonlyArray<ThreadChipTarget> {
  const targets = new Map<string, ThreadChipTarget>();
  if (hasThreadLinks(markdown)) {
    for (const [, href = ""] of markdown.matchAll(
      /\]\(((?:boops|t3)-thread:\/\/v[12]\/[^\s)]+)\)/g,
    )) {
      const link = parseThreadLinkHref(href);
      if (link) {
        targets.set(href, {
          href,
          environmentId: link.environmentId ?? environmentId,
          threadId: link.threadId,
          link: true,
        });
      }
    }
  }
  for (const record of records ?? []) {
    if (record.kind !== "thread" || !("threadId" in record)) continue;
    const href = formatComposerContextHref("thread", record.contextId);
    targets.set(href, {
      href,
      environmentId: record.environmentId,
      threadId: record.threadId,
      link: false,
    });
  }
  return [...targets.values()];
}

export function enrichedLinkVariantPattern(url: string) {
  return `^${url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`;
}

export const ENRICHED_INLINE_FILE_LINK_REGEX =
  /^(?!\S*:\/\/)(?:(?:\.{1,2}[\\/]|~[\\/]|\/(?:Users|home|tmp|var|etc|opt|mnt|Volumes|private|root|usr|bin|sbin|lib|lib64|srv|dev|proc|sys|run|boot|media|workspace|workspaces)\/|[A-Za-z]:[\\/])[^\s`]+|(?:[A-Za-z0-9._-]+[\\/])+[A-Za-z0-9._-]+\.[A-Za-z0-9_-]+(?::\d+){0,2}|[A-Za-z0-9._-]+\.[A-Za-z0-9_-]+:\d+(?::\d+)?)$/;

export function enrichedSkillLinkRegex(skills?: ReadonlyArray<SelectableMarkdownSkill>) {
  const names = [...new Set(skills?.map((skill) => skill.name) ?? [])].filter(Boolean);
  if (names.length === 0) return null;
  names.sort((a, b) => b.length - a.length);
  const alternatives = names.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(
    `(?<![A-Za-z0-9_-])(?<!\\p{Sc})\\p{Sc}(?:${alternatives.join("|")})(?![A-Za-z0-9_-])`,
    "u",
  );
}

const NO_MENTIONS: ReadonlyArray<string> = [];

/** The distinct `@Name` texts in `markdown` that would ask a bot, by the room's own rule. */
export function enrichedMentionTexts(
  markdown: string,
  names: ReadonlyArray<string>,
): ReadonlyArray<string> {
  const spans = roomMentionSpans(markdown, names);
  if (spans.length === 0) return NO_MENTIONS;
  return [...new Set(spans.map((span) => markdown.slice(span.start, span.end)))];
}

/**
 * Finds only the exact texts `enrichedMentionTexts` returned, with the same word edges, so the
 * native renderer decides nothing but which of them sit in prose rather than code or a link.
 */
export function enrichedMentionLinkRegex(texts: ReadonlyArray<string>): RegExp | null {
  if (texts.length === 0) return null;
  const alternatives = [...texts]
    .sort((a, b) => b.length - a.length)
    .map((text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  // The library refuses any lookbehind whose source has a brace, so `\p{L}` cannot be used; the
  // native engines read `\w` as every letter and digit.
  return new RegExp(`(?<![\\w-])(?:${alternatives.join("|")})(?![\\w-])`, "u");
}

export function enrichedSkillDisplayName(skill: SelectableMarkdownSkill) {
  return (
    skill.displayName?.trim() ||
    skill.name
      .split(/[\s:_-]+/)
      .filter(Boolean)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ")
  );
}

export function enrichedSkillReference(
  url: string,
  skills?: ReadonlyArray<SelectableMarkdownSkill>,
) {
  const match = /^\p{Sc}(.+)$/u.exec(url);
  return match ? skills?.find((skill) => skill.name === match[1]) : undefined;
}

export function enrichedSkillInstructionsPath(skill: SelectableMarkdownSkill) {
  return skill.path && !/^[a-z][a-z\d+.-]*:\/\//i.test(skill.path) ? skill.path : undefined;
}

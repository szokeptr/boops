import type {
  EnvironmentId,
  EnvironmentMachineKind,
  VcsRef,
  ProjectId,
  WorktreeSubmodules,
} from "@t3tools/contracts";

import * as Schema from "effect/Schema";
import { sanitizeNewRefName } from "@t3tools/shared/git";

import { workspaceRelativeFilePath } from "@t3tools/shared/path";

export { deriveLocalBranchNameFromRemoteRef, sanitizeNewRefName } from "@t3tools/shared/git";

export interface EnvironmentOption {
  environmentId: EnvironmentId;
  projectId: ProjectId | null;
  label: string;
  isPrimary: boolean;
  machine: EnvironmentMachineKind;
}

export const EnvMode = Schema.Literals(["local", "worktree"]);
export type EnvMode = typeof EnvMode.Type;

const GENERIC_LOCAL_ENVIRONMENT_LABELS = new Set(["local", "local environment"]);

function normalizeDisplayLabel(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

export function resolveEnvironmentOptionLabel(input: {
  isPrimary: boolean;
  environmentId: EnvironmentId;
  runtimeLabel?: string | null;
  savedLabel?: string | null;
}): string {
  const runtimeLabel = normalizeDisplayLabel(input.runtimeLabel);
  const savedLabel = normalizeDisplayLabel(input.savedLabel);

  if (input.isPrimary) {
    const preferredLocalLabel = [runtimeLabel, savedLabel].find((label) => {
      if (!label) return false;
      return !GENERIC_LOCAL_ENVIRONMENT_LABELS.has(label.toLowerCase());
    });
    return preferredLocalLabel ?? "This device";
  }

  return runtimeLabel ?? savedLabel ?? input.environmentId;
}

// Hysteresis prevents labels and icons from flapping at the width boundary.
const CONTEXT_STRIP_COMPACT_EXPAND_HYSTERESIS_PX = 16;

export function resolveContextStripLabelsCompact(input: {
  compact: boolean;
  neededWidth: number;
  availableWidth: number;
}): boolean {
  return input.compact
    ? input.neededWidth > input.availableWidth - CONTEXT_STRIP_COMPACT_EXPAND_HYSTERESIS_PX
    : input.neededWidth > input.availableWidth;
}

export function resolveEnvModeLabel(mode: EnvMode): string {
  return mode === "worktree" ? "New worktree" : "Current checkout";
}

export const WORKTREE_SUBMODULES_LABELS: Record<WorktreeSubmodules, string> = {
  recursive: "Recursive",
  "top-level": "Top level only",
  none: "Skip",
};

export interface PreviousWorktreeSeed {
  branch: string | null;
  worktreePath: string;
}

export function resolveEffectiveEnvMode(input: {
  activeWorktreePath: string | null;
  hasServerThread: boolean;
  draftThreadEnvMode: EnvMode | undefined;
  preparingWorktree?: boolean;
}): EnvMode {
  const { activeWorktreePath, hasServerThread, draftThreadEnvMode, preparingWorktree } = input;
  if (!hasServerThread) {
    if (activeWorktreePath) {
      return "local";
    }
    return draftThreadEnvMode === "worktree" ? "worktree" : "local";
  }
  return activeWorktreePath || preparingWorktree ? "worktree" : "local";
}

export function resolveDraftEnvModeAfterBranchChange(input: {
  nextWorktreePath: string | null;
  currentWorktreePath: string | null;
  effectiveEnvMode: EnvMode;
}): EnvMode {
  const { nextWorktreePath, currentWorktreePath, effectiveEnvMode } = input;
  if (nextWorktreePath) {
    return "worktree";
  }
  if (effectiveEnvMode === "worktree" && !currentWorktreePath) {
    return "worktree";
  }
  return "local";
}

export function resolveBranchTriggerLabel(input: {
  activeWorktreePath: string | null;
  effectiveEnvMode: EnvMode;
  resolvedActiveBranch: string | null;
  resolvedActiveBranchIsRemote: boolean | null;
  startFromOrigin: boolean;
}): string {
  const {
    activeWorktreePath,
    effectiveEnvMode,
    resolvedActiveBranch,
    resolvedActiveBranchIsRemote,
    startFromOrigin,
  } = input;
  if (!resolvedActiveBranch) {
    return "Select ref";
  }
  if (effectiveEnvMode === "worktree" && !activeWorktreePath) {
    // Only the server can determine a local branch's configured remote.
    return startFromOrigin && resolvedActiveBranchIsRemote === false
      ? `From ${resolvedActiveBranch} (remote)`
      : `From ${resolvedActiveBranch}`;
  }
  return resolvedActiveBranch;
}

export function resolveBranchToolbarPrBranch(input: {
  activeThreadBranch: string | null;
  resolvedActiveBranch: string | null;
}): string | null {
  return input.activeThreadBranch === input.resolvedActiveBranch ? input.activeThreadBranch : null;
}

export function resolveLocalCheckoutBranchMismatch(input: {
  effectiveEnvMode: EnvMode;
  activeWorktreePath: string | null;
  activeThreadBranch: string | null;
  currentGitBranch: string | null;
}): { threadBranch: string; currentBranch: string } | null {
  const { effectiveEnvMode, activeWorktreePath, activeThreadBranch, currentGitBranch } = input;
  if (effectiveEnvMode !== "local" || activeWorktreePath !== null) {
    return null;
  }
  if (!activeThreadBranch || !currentGitBranch || activeThreadBranch === currentGitBranch) {
    return null;
  }
  return { threadBranch: activeThreadBranch, currentBranch: currentGitBranch };
}

export function resolveBranchSelectionTarget(input: {
  activeProjectCwd: string;
  activeProjectCheckoutRoot?: string | undefined;
  activeWorktreePath: string | null;
  refName: Pick<VcsRef, "isDefault" | "worktreePath">;
}): {
  checkoutCwd: string;
  nextWorktreePath: string | null;
  reuseExistingWorktree: boolean;
} {
  const { activeProjectCwd, activeWorktreePath, refName } = input;

  if (refName.worktreePath) {
    // Until the project's checkout root loads, a checkout containing the project counts as its own.
    const isProjectCheckout =
      input.activeProjectCheckoutRoot === undefined
        ? workspaceRelativeFilePath(activeProjectCwd, refName.worktreePath) !== null
        : workspaceRelativeFilePath(input.activeProjectCheckoutRoot, refName.worktreePath) === ".";
    return {
      checkoutCwd: refName.worktreePath,
      nextWorktreePath: isProjectCheckout ? null : refName.worktreePath,
      reuseExistingWorktree: true,
    };
  }

  const nextWorktreePath =
    activeWorktreePath !== null && refName.isDefault ? null : activeWorktreePath;

  return {
    checkoutCwd: nextWorktreePath ?? activeProjectCwd,
    nextWorktreePath,
    reuseExistingWorktree: false,
  };
}

export function shouldIncludeBranchPickerItem(input: {
  itemValue: string;
  normalizedQuery: string;
  createBranchItemValue: string | null;
  checkoutPullRequestItemValue: string | null;
}): boolean {
  const { itemValue, normalizedQuery, createBranchItemValue, checkoutPullRequestItemValue } = input;

  if (normalizedQuery.length === 0) {
    return true;
  }

  if (createBranchItemValue && itemValue === createBranchItemValue) {
    return true;
  }

  if (checkoutPullRequestItemValue && itemValue === checkoutPullRequestItemValue) {
    return true;
  }

  const lowerItemValue = itemValue.toLowerCase();
  if (lowerItemValue.includes(normalizedQuery)) {
    return true;
  }

  const sanitizedQuery = sanitizeNewRefName(normalizedQuery);
  return (
    sanitizedQuery.length > 0 &&
    sanitizedQuery !== normalizedQuery &&
    lowerItemValue.includes(sanitizedQuery)
  );
}

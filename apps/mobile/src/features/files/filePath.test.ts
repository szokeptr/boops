import { describe, expect, it } from "vite-plus/test";

import { ProjectReadFileError, ThreadId } from "@t3tools/contracts";

import {
  fileRoutePathSegments,
  isBinaryFileReadFailure,
  rawWorkspaceFileResource,
  needsWorkspaceFileContents,
  resolveFileLinkPath,
  resolveWorkspaceRelativeFilePath,
} from "./filePath";

describe("resolveFileLinkPath", () => {
  it.each([
    ["/home/maria/project", "~/.agents/AGENTS.md", "/home/maria/.agents/AGENTS.md"],
    ["/Users/maria/project", "~/notes.md", "/Users/maria/notes.md"],
    ["C:\\Users\\maria\\project", "~\\.agents\\AGENTS.md", "C:\\Users\\maria\\.agents\\AGENTS.md"],
  ])("expands a home link from %s", (cwd, path, expected) => {
    expect(resolveFileLinkPath(cwd, path)).toBe(expected);
    expect(fileRoutePathSegments(expected).join("/")).toBe(expected);
  });

  it("does not turn an unresolved home into a workspace path", () => {
    expect(resolveFileLinkPath("/repo", "~/notes.md")).toBeNull();
    expect(resolveFileLinkPath(null, "~/notes.md")).toBeNull();
    expect(resolveFileLinkPath("/repo", "../notes.md")).toBeNull();
  });
});

describe("resolveWorkspaceRelativeFilePath", () => {
  it("converts absolute paths inside the workspace", () => {
    expect(
      resolveWorkspaceRelativeFilePath("/Users/julius/repo", "/Users/julius/repo/src/main.ts"),
    ).toBe("src/main.ts");
    expect(resolveWorkspaceRelativeFilePath("C:\\repo", "c:\\repo\\src\\main.ts")).toBe(
      "src/main.ts",
    );
  });

  it("recognizes home links inside the workspace", () => {
    expect(resolveWorkspaceRelativeFilePath("/home/maria/project", "~/project/src/main.ts")).toBe(
      "src/main.ts",
    );
    expect(
      resolveWorkspaceRelativeFilePath("/home/maria/project", "~/.agents/AGENTS.md"),
    ).toBeNull();
  });

  it("rejects paths outside the workspace", () => {
    expect(resolveWorkspaceRelativeFilePath("/repo", "/other/main.ts")).toBeNull();
    expect(resolveWorkspaceRelativeFilePath("/repo", "../other/main.ts")).toBeNull();
    expect(resolveWorkspaceRelativeFilePath("/repo", "/repo/../outside.txt")).toBeNull();
    expect(resolveWorkspaceRelativeFilePath(null, "/repo/main.ts")).toBeNull();
  });
});

describe("needsWorkspaceFileContents", () => {
  it("reads a text file while its metadata is still pending, but not a directory", () => {
    const input = { relativePath: "package.json", activeMode: "source" } as const;
    expect(needsWorkspaceFileContents({ ...input, metadataKind: undefined })).toBe(true);
    expect(needsWorkspaceFileContents({ ...input, metadataKind: "directory" })).toBe(false);
  });
});

describe("isBinaryFileReadFailure", () => {
  const readError = (failure: ProjectReadFileError["failure"] & string) =>
    new ProjectReadFileError({ cwd: "/workspace", relativePath: "part.3mf", failure });

  it("recognizes the server's binary-file refusal", () => {
    expect(isBinaryFileReadFailure(readError("binary_file"))).toBe(true);
  });

  it("leaves other read failures as errors", () => {
    expect(isBinaryFileReadFailure(readError("operation_failed"))).toBe(false);
    expect(isBinaryFileReadFailure(readError("path_not_file"))).toBe(false);
    expect(isBinaryFileReadFailure(new Error("binary_file"))).toBe(false);
    expect(isBinaryFileReadFailure(null)).toBe(false);
  });
});

describe("rawWorkspaceFileResource", () => {
  it("downloads a thread's file as an attachment", () => {
    expect(
      rawWorkspaceFileResource({
        threadId: ThreadId.make("thread-1"),
        cwd: "/workspace",
        relativePath: "a/b/part.3mf",
        absolutePath: "/workspace/a/b/part.3mf",
      }),
    ).toEqual({
      _tag: "media-file",
      threadId: "thread-1",
      path: "/workspace/a/b/part.3mf",
      disposition: "attachment",
    });
  });

  it("reads a draft's file through its workspace", () => {
    expect(
      rawWorkspaceFileResource({
        threadId: null,
        cwd: "/workspace",
        relativePath: "a/b/part.3mf",
        absolutePath: "/workspace/a/b/part.3mf",
      }),
    ).toEqual({ _tag: "draft-workspace-file", cwd: "/workspace", path: "a/b/part.3mf" });
  });
});

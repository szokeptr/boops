import { expect, it } from "@effect/vitest";
import {
  CommandId,
  EnvironmentMemberId,
  MessageId,
  type OrchestrationProjectShell,
  type OrchestrationV2Command,
  type OrchestrationV2ShellSnapshot,
  type OrchestrationV2ThreadShell,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";

import { liveThreadShell } from "../mcp/McpToolAccess.testkit.ts";
import {
  authorizeMemberCommand,
  makeShellAudience,
  type MemberContext,
  type MemberThreadRow,
} from "./memberFence.ts";

const anna = EnvironmentMemberId.make("anna");
const bob = EnvironmentMemberId.make("bob");
const sharedBot = ProjectId.make("project:shared");
const privateBot = ProjectId.make("project:private");

const project = (
  id: ProjectId,
  memberIds: ReadonlyArray<EnvironmentMemberId>,
): OrchestrationProjectShell => ({
  id,
  title: id,
  workspaceRoot: `/home/user/boops/${id}`,
  defaultModelSelection: null,
  scripts: [],
  mainThreadId: ThreadId.make(`${id}:owner-main`),
  memberIds,
  createdAt: "2026-11-06T00:00:00.000Z",
  updatedAt: "2026-11-06T00:00:00.000Z",
});

const origin = (memberId: EnvironmentMemberId) => ({
  sessionId: `member:${memberId}`,
  label: memberId,
  access: "auto-accept-edits" as const,
  memberId,
});

const thread = (
  id: string,
  projectId: ProjectId,
  memberId?: EnvironmentMemberId,
  createdAtMs = 0,
): OrchestrationV2ThreadShell => ({
  ...liveThreadShell(ThreadId.make(id)),
  projectId,
  createdAt: DateTime.makeUnsafe(createdAtMs),
  ...(memberId === undefined ? {} : { linkOrigin: origin(memberId) }),
});

const row = (shell: OrchestrationV2ThreadShell): MemberThreadRow => ({
  threadId: shell.id,
  projectId: shell.projectId,
  memberId: shell.linkOrigin!.memberId!,
  createdAtMs: DateTime.toEpochMillis(shell.createdAt),
  archived: shell.archivedAt !== null,
  listed: true,
});

const ownerChat = thread("thread:owner", sharedBot);
const annaLater = thread("thread:anna-later", sharedBot, anna, 2_000);
const annaFirst = thread("thread:anna-first", sharedBot, anna, 1_000);
const annaInPrivate = thread("thread:anna-private", privateBot, anna, 500);
const bobChat = thread("thread:bob", sharedBot, bob, 100);
const memberThreads = [annaLater, annaFirst, annaInPrivate, bobChat];
const snapshot: OrchestrationV2ShellSnapshot = {
  schemaVersion: 1,
  snapshotSequence: 10,
  projects: [project(sharedBot, [anna, bob]), project(privateBot, [])],
  threads: [ownerChat, ...memberThreads],
  archivedThreads: [],
};

it("shows a member only her threads in bots shared with her, and the owner none of hers", () => {
  const member = makeShellAudience(anna, memberThreads.map(row));
  expect(member.mayRead(ownerChat.id)).toBe(false);
  expect(member.mayRead(annaFirst.id)).toBe(true);
  const hers = member.viewSnapshot(snapshot);
  expect(hers.projects).toEqual([
    { ...project(sharedBot, [anna, bob]), memberIds: [anna], mainThreadId: annaFirst.id },
  ]);
  expect(hers.threads.map((shell) => shell.id)).toEqual([annaLater.id, annaFirst.id]);

  const owner = makeShellAudience(undefined, memberThreads.map(row));
  expect(owner.mayRead(ownerChat.id)).toBe(true);
  expect(owner.mayRead(bobChat.id)).toBe(false);
  const theirs = owner.viewSnapshot(snapshot);
  expect(theirs.projects).toEqual(snapshot.projects);
  expect(theirs.threads.map((shell) => shell.id)).toEqual([ownerChat.id]);
});

it("keeps a member's live shell in step: new threads, a moved conversation, and unsharing", () => {
  const member = makeShellAudience(anna, memberThreads.map(row));
  member.viewSnapshot(snapshot);
  const newThread = ThreadId.make("thread:anna-new");
  member.learn(newThread, anna);
  expect(member.mayRead(newThread)).toBe(true);

  expect(
    member.viewItem({
      kind: "thread.updated",
      sequence: 11,
      location: "active",
      thread: ownerChat,
    }),
  ).toEqual([]);
  // Archiving her first conversation moves the bot to the next one.
  expect(
    member.viewItem({
      kind: "thread.removed",
      sequence: 12,
      location: "active",
      threadId: annaFirst.id,
    }),
  ).toEqual([
    { kind: "thread.removed", sequence: 12, location: "active", threadId: annaFirst.id },
    {
      kind: "project.updated",
      sequence: 12,
      project: {
        ...project(sharedBot, [anna, bob]),
        memberIds: [anna],
        mainThreadId: annaLater.id,
      },
    },
  ]);
  expect(
    member.viewItem({ kind: "project.updated", sequence: 13, project: project(sharedBot, [bob]) }),
  ).toEqual([
    { kind: "thread.removed", sequence: 13, location: "active", threadId: annaLater.id },
    { kind: "thread.removed", sequence: 13, location: "active", threadId: annaFirst.id },
    { kind: "project.removed", sequence: 13, projectId: sharedBot },
  ]);
  expect(
    member.viewItem({
      kind: "thread.updated",
      sequence: 14,
      location: "active",
      thread: annaLater,
    }),
  ).toEqual([]);
});

const instanceId = ProviderInstanceId.make("codex");
const contextFor = (memberId: EnvironmentMemberId): MemberContext<never> => {
  const shells = new Map(snapshot.threads.map((shell) => [shell.id, shell] as const));
  const projects = new Map(snapshot.projects.map((shell) => [shell.id, shell] as const));
  return {
    memberId,
    threadShell: (threadId) => Effect.succeed(shells.get(threadId) ?? null),
    project: (projectId) => Effect.succeed(projects.get(projectId)),
    origin: Effect.succeed(origin(memberId)),
  };
};
const message = (
  threadId: ThreadId,
): Extract<OrchestrationV2Command, { readonly type: "message.dispatch" }> => ({
  type: "message.dispatch",
  createdBy: "user",
  creationSource: "mobile",
  commandId: CommandId.make(`message:${threadId}`),
  threadId,
  messageId: MessageId.make(`message:${threadId}`),
  text: "Hi",
  attachments: [],
  dispatchMode: { type: "start_immediately" },
});
const create = (projectId: ProjectId): OrchestrationV2Command => ({
  type: "thread.create",
  commandId: CommandId.make(`create:${projectId}`),
  threadId: ThreadId.make(`thread:new:${projectId}`),
  projectId,
  title: "New conversation",
  modelSelection: { instanceId, model: "gpt-5" },
  runtimeMode: "full-access",
  interactionMode: "default",
  branch: null,
  worktreePath: null,
  createdBy: "user",
  creationSource: "mobile",
});

it.effect("lets a member chat only in her own threads and stamps the threads she starts", () =>
  Effect.gen(function* () {
    const authorize = (command: OrchestrationV2Command) =>
      authorizeMemberCommand(contextFor(anna), command).pipe(
        Effect.catchTags({ EnvironmentAuthorizationError: () => Effect.succeed("denied") }),
      );

    expect(yield* authorize(message(annaFirst.id))).toEqual(message(annaFirst.id));
    expect(yield* authorize(message(ownerChat.id))).toBe("denied");
    expect(yield* authorize(message(bobChat.id))).toBe("denied");
    expect(
      yield* authorize({
        ...message(annaFirst.id),
        modelSelection: { instanceId: ProviderInstanceId.make("claude"), model: "opus" },
      }),
    ).toBe("denied");
    expect(
      yield* authorize({
        type: "thread.delete",
        commandId: CommandId.make("delete"),
        threadId: annaFirst.id,
      }),
    ).toBe("denied");

    expect(yield* authorize(create(sharedBot))).toEqual({
      ...create(sharedBot),
      runtimeMode: "auto-accept-edits",
      linkOrigin: origin(anna),
    });
    expect(yield* authorize(create(privateBot))).toBe("denied");
  }),
);

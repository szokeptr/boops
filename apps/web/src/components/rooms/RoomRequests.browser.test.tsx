import {
  EnvironmentId,
  ProjectId,
  RoomId,
  type RoomPendingRequest,
  RuntimeRequestId,
} from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import { RoomRequests } from "./RoomRequests";

const state = vi.hoisted(() => ({
  requests: [] as ReadonlyArray<unknown>,
  respond: vi.fn(),
}));

vi.mock(import("../../state/rooms"), async (original) => ({
  ...(await original()),
  useRoomFeed: (() => ({ data: { requests: state.requests } })) as never,
}));
vi.mock(import("../../state/use-atom-command"), async (original) => ({
  ...(await original()),
  useAtomCommand: (() => state.respond) as never,
}));

const environmentId = EnvironmentId.make("environment-1");
const roomId = RoomId.make("room-1");
const projectId = ProjectId.make("project-scout");

function setup(request: Partial<RoomPendingRequest>) {
  state.respond = vi.fn(async () => ({ _tag: "Success", value: undefined }));
  state.requests = [
    {
      projectId,
      botName: "Scout",
      requestId: RuntimeRequestId.make("request-1"),
      kind: "question",
      prompt: null,
      requestKind: "user-input",
      questions: [],
      askedFor: { kind: "owner" },
      askedForName: "Owner",
      canAnswer: true,
      createdAt: "2026-11-10T10:00:00.000Z",
      ...request,
    } satisfies RoomPendingRequest,
  ];
}

const bots = [{ projectId, name: "Scout", avatar: null, threadId: null }];

describe("RoomRequests", () => {
  it("answers a question that takes only free text", async () => {
    setup({
      questions: [{ id: "where", header: "Where", question: "Where should I look?", options: [] }],
    });
    await using screen = await render(
      <RoomRequests environmentId={environmentId} roomId={roomId} bots={bots} />,
      // The cards never link anywhere.
      { router: false },
    );
    await userEvent.click(screen.getByRole("button", { name: "Something else" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Your answer" }), "The attic");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(state.respond).toHaveBeenCalledWith({
      environmentId,
      input: {
        roomId,
        projectId,
        requestId: "request-1",
        answers: { where: "The attic" },
      },
    });
  });

  it("offers no session-wide allow", async () => {
    setup({ kind: "approval", requestKind: "command", prompt: "rm -rf build" });
    await using screen = await render(
      <RoomRequests environmentId={environmentId} roomId={roomId} bots={bots} />,
      // The cards never link anywhere.
      { router: false },
    );
    await userEvent.click(screen.getByRole("button", { name: "More approval options" }));
    await expect.element(page.getByRole("menuitem", { name: "Cancel" })).toBeVisible();
    expect(page.getByRole("menuitem").elements()).toHaveLength(1);
  });

  it("uses the provider's own choices, minus any a room refuses", async () => {
    setup({
      kind: "approval",
      requestKind: "command",
      prompt: "rm -rf build",
      options: [
        { decision: "acceptForSession", label: "Yes, and don't ask again" },
        { decision: "accept", label: "Yes, run it" },
        { decision: "decline", label: "No" },
      ],
    });
    await using screen = await render(
      <RoomRequests environmentId={environmentId} roomId={roomId} bots={bots} />,
      // The cards never link anywhere.
      { router: false },
    );
    await userEvent.click(screen.getByRole("button", { name: "Yes, run it" }));
    expect(state.respond).toHaveBeenCalledWith({
      environmentId,
      input: { roomId, projectId, requestId: "request-1", decision: "accept" },
    });
    await expect.element(screen.getByRole("button", { name: "No" })).toBeVisible();
    expect(screen.getByRole("button", { name: "More approval options" }).elements()).toHaveLength(
      0,
    );
  });
});

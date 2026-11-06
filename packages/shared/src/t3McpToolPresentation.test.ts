import { describe, expect, it } from "vite-plus/test";

import {
  T3_MCP_TOOL_NAMES,
  resolveT3McpSummaryAction,
  resolveT3McpToolDefinition,
  resolveT3McpToolPresentation,
} from "./t3McpToolPresentation.ts";

describe("resolveT3McpToolPresentation", () => {
  it("recognizes every Boops tool across provider prefixes and completion suffixes", () => {
    for (const tool of T3_MCP_TOOL_NAMES) {
      const presentation = resolveT3McpToolPresentation(tool);
      for (const prefix of [
        "mcp__boops__",
        "mcp__t3-code__",
        "mcp__t3_code__",
        "mcp__t3code__",
        "T3-code.",
        "t3code.",
        "boops-direct.",
        "mcp__boops_direct__",
        "t3_code/",
        "t3code:",
        "mcp_t3-code_",
        "T3 Code ",
        "Boops ",
        "t3-code · ",
      ]) {
        expect(resolveT3McpToolPresentation(`${prefix}${tool} completed`), tool).toEqual(
          presentation,
        );
      }
      expect(resolveT3McpToolPresentation(`mcp__another-server__${tool}`), tool).toBeNull();
    }
  });

  it("matches OpenCode 2's per-thread server names, whose thread ids hold underscores", () => {
    expect(
      resolveT3McpToolPresentation("t3-code-thread_opencode2-adapter_delegate_task")?.displayName,
    ).toBe("Delegate a child task");
    expect(resolveT3McpToolPresentation("t3-code-thread_opencode2-adapter_not_a_tool")).toBeNull();
    expect(
      resolveT3McpToolPresentation("boops-thread_opencode2-adapter_boops_thread_read")?.displayName,
    ).toBe("Read a Boops thread");
  });

  it("resolves the t3_ tool names older threads recorded", () => {
    for (const legacy of [
      "mcp__t3-code__t3_thread_read",
      "t3-code.t3_thread_read",
      "t3-code-thread_opencode2-adapter_t3_thread_read",
    ]) {
      expect(resolveT3McpToolDefinition(legacy), legacy).toBe(
        resolveT3McpToolDefinition("boops_thread_read"),
      );
    }
    expect(resolveT3McpToolDefinition("mcp__t3-code__t3_queue", { action: "list" })).toBe(
      resolveT3McpToolDefinition("t3_queue_list"),
    );
  });
});

describe("resolveT3McpToolDefinition", () => {
  it("labels an action tool call as the action it ran", () => {
    expect(
      resolveT3McpToolDefinition("mcp__boops__preview_act", { action: "type" })?.labels,
    ).toEqual(resolveT3McpToolDefinition("preview_type")?.labels);
    expect(
      resolveT3McpToolDefinition("boops_thread_transfer", { action: "fork" })?.displayName,
    ).toBe(resolveT3McpToolDefinition("t3_thread_fork")?.displayName);
    expect(resolveT3McpToolDefinition("preview_act", { action: "unknown" })?.labels[2]).toBe(
      "Used",
    );
  });
});

describe("resolveT3McpSummaryAction", () => {
  it("summarizes an action tool by the action each call ran", () => {
    expect(resolveT3McpSummaryAction("mcp__boops__boops_queue", { action: "list" })).toBe(
      "queue-list",
    );
    expect(resolveT3McpSummaryAction("boops_queue", { action: "edit" })).toBe("queue-edit");
    expect(resolveT3McpSummaryAction("boops_thread_transfer", { action: "status" })).toBe(
      "thread-transfers",
    );
    expect(resolveT3McpSummaryAction("boops_thread_configure", {})).toBe("thread-configuration");
    expect(resolveT3McpSummaryAction("schedule_task", { scheduledTaskId: "task-1" })).toBe(
      "schedule-update",
    );
    expect(resolveT3McpSummaryAction("delegate_task", { task: "x" })).toBe("delegate");
  });
});

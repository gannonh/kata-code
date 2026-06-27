// @effect-diagnostics nodeBuiltinImport:off
import { describe, expect, it } from "@effect/vitest";

import { mapPiMessageHistory } from "./piThreadHistory.ts";

describe("piThreadHistory", () => {
  describe("mapPiMessageHistory", () => {
    it("returns an empty array when there are no messages", () => {
      expect(mapPiMessageHistory([])).toEqual([]);
    });

    it("maps a user message to a user_message item", () => {
      const items = mapPiMessageHistory([{ role: "user", content: "hello", timestamp: 1 }]);
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({ type: "user_message", text: "hello" });
    });

    it("maps user text-content blocks to a single user_message item", () => {
      const items = mapPiMessageHistory([
        {
          role: "user",
          content: [
            { type: "text", text: "one" },
            { type: "text", text: "two" },
          ],
          timestamp: 1,
        },
      ]);
      expect(items).toHaveLength(1);
      expect((items[0] as { type: string; text: string }).text).toBe("one\n\ntwo");
    });

    it("skips a user message that yields no text", () => {
      const items = mapPiMessageHistory([
        {
          role: "user",
          content: [{ type: "image", data: "x", mimeType: "image/png" }],
          timestamp: 1,
        },
      ]);
      expect(items).toEqual([]);
    });

    it("maps assistant text, thinking, and tool-call content blocks", () => {
      const items = mapPiMessageHistory([
        {
          role: "assistant",
          content: [
            { type: "text", text: "Sure" },
            { type: "thinking", thinking: "pondering" },
            { type: "toolCall", id: "call-1", name: "bash", arguments: { command: "npm test" } },
          ],
          api: "anthropic-messages",
          provider: "anthropic",
          model: "claude",
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          stopReason: "stop",
          timestamp: 1,
        },
      ]);
      expect(items).toHaveLength(3);
      expect(items[0]).toMatchObject({ type: "assistant_message", text: "Sure" });
      expect(items[1]).toMatchObject({ type: "reasoning", text: "pondering" });
      const toolCall = items[2] as Record<string, unknown>;
      expect(toolCall.type).toBe("tool_call");
      expect(toolCall.status).toBe("started");
      expect(toolCall.callId).toBe("call-1");
      expect(toolCall.toolName).toBe("bash");
      expect(toolCall.itemType).toBe("command_execution");
      expect(toolCall.title).toBe("npm test");
      expect((toolCall.data as { command: string }).command).toBe("npm test");
    });

    it("pairs a toolResult message with its pending tool call", () => {
      const items = mapPiMessageHistory([
        {
          role: "assistant",
          content: [{ type: "toolCall", id: "call-1", name: "bash", arguments: { command: "ls" } }],
          api: "anthropic-messages",
          provider: "anthropic",
          model: "claude",
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          stopReason: "stop",
          timestamp: 1,
        },
        {
          role: "toolResult",
          toolCallId: "call-1",
          toolName: "bash",
          content: [{ type: "text", text: "file.txt" }],
          isError: false,
          timestamp: 2,
        },
      ]);
      expect(items).toHaveLength(2);
      const started = items[0] as Record<string, unknown>;
      expect(started.status).toBe("started");
      const completed = items[1] as Record<string, unknown>;
      expect(completed.type).toBe("tool_call");
      expect(completed.status).toBe("completed");
      expect(completed.callId).toBe("call-1");
      expect(completed.output).toBe("file.txt");
      expect(completed.isError as boolean).toBe(false);
    });

    it("marks a tool result with isError as failed", () => {
      const items = mapPiMessageHistory([
        {
          role: "assistant",
          content: [
            { type: "toolCall", id: "call-2", name: "bash", arguments: { command: "boom" } },
          ],
          api: "anthropic-messages",
          provider: "anthropic",
          model: "claude",
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          stopReason: "stop",
          timestamp: 1,
        },
        {
          role: "toolResult",
          toolCallId: "call-2",
          toolName: "bash",
          content: [{ type: "text", text: "Error: ENOTFOUND" }],
          isError: true,
          timestamp: 2,
        },
      ]);
      const completed = items[1] as Record<string, unknown>;
      expect(completed.status).toBe("failed");
      expect(completed.isError).toBe(true);
    });

    it("emits a tool result even when its tool call was not seen (no pending tool)", () => {
      const items = mapPiMessageHistory([
        {
          role: "toolResult",
          toolCallId: "call-orphan",
          toolName: "grep",
          content: [{ type: "text", text: "match" }],
          isError: false,
          timestamp: 1,
        },
      ]);
      expect(items).toHaveLength(1);
      const result = items[0] as Record<string, unknown>;
      expect(result.type).toBe("tool_call");
      expect(result.status).toBe("completed");
      expect(result.toolName).toBe("grep");
      expect(result.itemType).toBe("web_search");
    });
  });
});

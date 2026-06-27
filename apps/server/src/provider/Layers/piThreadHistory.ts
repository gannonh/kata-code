/**
 * Pure helpers that map a Pi SDK session's message history onto Kata thread
 * snapshot items. Extracted from {@link ./PiAdapter.ts} so the mapping is
 * unit-testable without an SDK session, mirroring the tool-lifecycle helpers
 * in {@link ./piToolLifecycle.ts}.
 *
 * The Pi SDK `AgentSession.messages` array contains `AgentMessage` values
 * (user / assistant / toolResult plus custom message kinds). Only the LLM
 * message shapes participate in the thread snapshot; unknown custom kinds are
 * ignored. The message shape is structural: this helper treats the SDK
 * messages as `unknown` and narrows by `role`/`type` so it stays independent
 * of the (uninstalled in some worktrees) Pi SDK type definitions.
 *
 * @module provider/Layers/piThreadHistory
 */
import { toolItemType, toolLifecycleData, toolTitle } from "./piToolLifecycle.ts";

type ContentBlock = Record<string, unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Extract concatenated text from a user/assistant message `content` field. */
function textFromContent(content: unknown): string | undefined {
  if (typeof content === "string") {
    return content.length > 0 ? content : undefined;
  }
  if (!Array.isArray(content)) return undefined;
  const parts = content.flatMap((block) => {
    const record = isRecord(block) ? block : undefined;
    return record?.type === "text" && typeof record.text === "string" ? [record.text] : [];
  });
  return parts.length > 0 ? parts.join("\n\n") : undefined;
}

function arrayContent(content: unknown): ContentBlock[] {
  return Array.isArray(content) ? content.filter(isRecord) : [];
}

/**
 * Map a Pi SDK session message history into Kata thread-snapshot items:
 * user messages → `user_message`, assistant text → `assistant_message`,
 * assistant thinking → `reasoning`, assistant tool calls → `tool_call`
 * (status `started`), and tool results → `tool_call` (status `completed` or
 * `failed`).
 *
 * Tool results are emitted as separate items (mirroring Synara's
 * `mapMessageHistory`) rather than mutating the prior tool-call item, so the
 * snapshot preserves the order in which messages arrived.
 */
export function mapPiMessageHistory(messages: ReadonlyArray<unknown>): unknown[] {
  const items: unknown[] = [];
  const pendingTools = new Map<string, { toolName: string; args: unknown }>();
  for (const message of messages) {
    if (!isRecord(message)) continue;
    const role = message.role;
    if (role === "user") {
      const text = textFromContent(message.content);
      if (text) items.push({ type: "user_message", text });
      continue;
    }
    if (role === "assistant") {
      for (const block of arrayContent(message.content)) {
        if (block.type === "text" && typeof block.text === "string") {
          items.push({ type: "assistant_message", text: block.text });
          continue;
        }
        if (block.type === "thinking" && typeof block.thinking === "string") {
          items.push({ type: "reasoning", text: block.thinking });
          continue;
        }
        if (block.type === "toolCall" && typeof block.id === "string") {
          const toolName = typeof block.name === "string" ? block.name : "unknown";
          const args = block.arguments;
          pendingTools.set(block.id, { toolName, args });
          items.push({
            type: "tool_call",
            status: "started",
            callId: block.id,
            toolName,
            itemType: toolItemType(toolName),
            title: toolTitle(toolName, args),
            args,
            data: toolLifecycleData({ toolCallId: block.id, toolName, args }),
          });
        }
      }
      continue;
    }
    if (role === "toolResult") {
      const toolCallId = typeof message.toolCallId === "string" ? message.toolCallId : undefined;
      const pending = toolCallId ? pendingTools.get(toolCallId) : undefined;
      if (toolCallId) pendingTools.delete(toolCallId);
      const toolName =
        pending?.toolName ?? (typeof message.toolName === "string" ? message.toolName : "unknown");
      const args = pending?.args;
      const isError = message.isError === true;
      const output = textFromContent(message.content);
      const result = { content: message.content };
      if (!toolCallId) continue;
      items.push({
        type: "tool_call",
        status: isError ? "failed" : "completed",
        callId: toolCallId,
        toolName,
        itemType: toolItemType(toolName),
        title: toolTitle(toolName, args),
        ...(output !== undefined ? { output } : {}),
        isError,
        data: toolLifecycleData({ toolCallId, toolName, args, result, isError }),
      });
    }
  }
  return items;
}

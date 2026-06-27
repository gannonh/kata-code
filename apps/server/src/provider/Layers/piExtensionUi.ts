/**
 * Pi extension UI bridge helpers: structural types, the plain passthrough
 * theme, and option-mapping utilities used by the adapter's
 * `makePiExtensionUIContext`.
 *
 * The Pi SDK is not always installed in the worktree (pre-existing missing
 * module errors). These helpers keep the extension UI bridge typecheck-stable
 * by modeling only the surface the adapter depends on, instead of importing
 * `ExtensionUIContext`/`Theme` from the SDK.
 *
 * @module provider/Layers/piExtensionUi
 */
import type { ProviderUserInputAnswers, UserInputQuestion } from "@kata-sh/code-contracts";

/** Abort/timeout options for Pi extension dialog methods. Mirrors
 *  `ExtensionUIDialogOptions` from the Pi SDK. */
export interface PiExtensionUIDialogOptions {
  readonly signal?: AbortSignal;
  readonly timeout?: number;
}

/**
 * Structural slice of the Pi SDK `ExtensionUIContext` the adapter binds to a
 * session. Methods are grouped by bridge behavior:
 *
 * - dialog (`select`/`confirm`/`input`/`editor`): publish a
 *   `user-input.requested` event and wait for `respondToUserInput`.
 * - notify/status/progress (`notify`/`setStatus`/`setWorkingMessage`/
 *   `setTitle`): emit `runtime.warning` or `tool.progress`.
 * - TUI-only (`onTerminalInput`/`setWidget`/`setFooter`/`setHeader`/`custom`/
 *   `pasteToEditor`/`setEditorComponent`/`addAutocompleteProvider`): emit one
 *   `runtime.warning` per method per session, then return no-op values.
 * - no-op getters/state: safe defaults with no warning.
 */
export interface PiExtensionUIContext {
  select(
    title: string,
    options: string[],
    opts?: PiExtensionUIDialogOptions,
  ): Promise<string | undefined>;
  confirm(title: string, message: string, opts?: PiExtensionUIDialogOptions): Promise<boolean>;
  input(
    title: string,
    placeholder?: string,
    opts?: PiExtensionUIDialogOptions,
  ): Promise<string | undefined>;
  notify(message: string, type?: "info" | "warning" | "error"): void;
  onTerminalInput(
    handler: (data: string) => { consume?: boolean; data?: string } | undefined,
  ): () => void;
  setStatus(key: string, text: string | undefined): void;
  setWorkingMessage(message?: string): void;
  setWorkingVisible(visible: boolean): void;
  setWorkingIndicator(options?: { frames?: string[]; intervalMs?: number }): void;
  setHiddenThinkingLabel(label?: string): void;
  setWidget(
    key: string,
    content: string[] | undefined,
    options?: { placement?: "aboveEditor" | "belowEditor" },
  ): void;
  setFooter(factory: unknown): void;
  setHeader(factory: unknown): void;
  setTitle(title: string): void;
  custom<T>(
    factory: unknown,
    options?: { overlay?: boolean; overlayOptions?: unknown; onHandle?: (handle: unknown) => void },
  ): Promise<T>;
  pasteToEditor(text: string): void;
  setEditorText(text: string): void;
  getEditorText(): string;
  editor(title: string, prefill?: string): Promise<string | undefined>;
  addAutocompleteProvider(factory: unknown): void;
  setEditorComponent(factory: unknown): void;
  getEditorComponent(): unknown;
  readonly theme: PiExtensionTheme;
  getAllThemes(): Array<{ name: string; path: string | undefined }>;
  getTheme(name: string): PiExtensionTheme | undefined;
  setTheme(theme: string | PiExtensionTheme): { success: boolean; error?: string };
  getToolsExpanded(): boolean;
  setToolsExpanded(expanded: boolean): void;
}

/**
 * Structural slice of the Pi SDK `Theme` the bridge exposes. All transforms
 * return text unchanged so extensions that style text get a readable plain
 * rendering instead of ANSI codes in a web UI.
 */
export interface PiExtensionTheme {
  fg(color: string, text: string): string;
  bg(color: string, text: string): string;
  bold(text: string): string;
  italic(text: string): string;
  underline(text: string): string;
  inverse(text: string): string;
  strikethrough(text: string): string;
  getFgAnsi(color: string): string;
  getBgAnsi(color: string): string;
  getColorMode(): "truecolor" | "ansi256" | "ansi16";
  getThinkingBorderColor(): (text: string) => string;
  getBashModeBorderColor(): (text: string) => string;
}

/**
 * Plain passthrough theme for embedded Pi sessions. Color/style transforms
 * return text unchanged; ansi accessors return empty strings; color mode is
 * `truecolor`; border color accessors return identity functions. Extensions
 * that call `ctx.ui.theme.fg(...)` get readable text in a web UI instead of
 * raw ANSI escapes.
 */
export const PLAIN_PI_EXTENSION_THEME: PiExtensionTheme = {
  fg: (_color: string, text: string) => text,
  bg: (_color: string, text: string) => text,
  bold: (text: string) => text,
  italic: (text: string) => text,
  underline: (text: string) => text,
  inverse: (text: string) => text,
  strikethrough: (text: string) => text,
  getFgAnsi: () => "",
  getBgAnsi: () => "",
  getColorMode: () => "truecolor",
  getThinkingBorderColor: () => (text: string) => text,
  getBashModeBorderColor: () => (text: string) => text,
};

/** Map from a bridged question's answer label back to the original option
 *  string supplied to `select`. */
export interface PiUserInputOptionMapping {
  /** Original option string passed to `select`. */
  readonly value: string;
  /** Deduped option surfaced in the `UserInputQuestion`. */
  readonly option: UserInputQuestion["options"][number];
}

/** Returns `value` trimmed, or `undefined` if the result is empty. */
export function trimToUndefined(value: string | null | undefined): string | undefined {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed.length > 0 ? trimmed : undefined;
}

/** Build a single `UserInputQuestion` option from a label, defaulting to
 *  "Option" for empty labels. The label is reused as the description. */
export function makePiUserInputOption(label: string): UserInputQuestion["options"][number] {
  const normalizedLabel = trimToUndefined(label) ?? "Option";
  return { label: normalizedLabel, description: normalizedLabel };
}

/**
 * Map a `select` option array onto deduped `UserInputQuestion` options.
 * Duplicate labels get an index suffix (`label (2)`) so the answer label the
 * user picks always maps back to exactly one original option string.
 */
export function makePiUserInputOptions(
  labels: ReadonlyArray<string>,
): ReadonlyArray<PiUserInputOptionMapping> {
  const labelCounts = new Map<string, number>();
  return labels.map((label, index) => {
    const baseLabel = trimToUndefined(label) ?? `Option ${index + 1}`;
    const count = (labelCounts.get(baseLabel) ?? 0) + 1;
    labelCounts.set(baseLabel, count);
    const displayLabel = count === 1 ? baseLabel : `${baseLabel} (${count})`;
    return {
      value: label,
      option: { label: displayLabel, description: baseLabel },
    };
  });
}

/** Read the first string answer for a question id from a user-input answers
 *  record, trimmed. Handles single-string and string-array answers. */
export function firstPiUserInputAnswer(
  answers: ProviderUserInputAnswers,
  questionId: string,
): string | undefined {
  const answer = answers[questionId];
  if (typeof answer === "string") {
    return trimToUndefined(answer);
  }
  if (Array.isArray(answer)) {
    return trimToUndefined(answer.find((entry) => typeof entry === "string"));
  }
  return undefined;
}

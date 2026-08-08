import { type RuntimeMode } from "@kata-sh/code-contracts";
import { LockIcon, LockOpenIcon, PenLineIcon, type LucideIcon } from "lucide-react";

/**
 * One source of truth for runtime-mode presentation across the app: the chat
 * composer, the Create Task form, and the Task panel all render the same
 * label, description, and icon for a given mode.
 */
export const runtimeModeConfig: Record<
  RuntimeMode,
  { readonly label: string; readonly description: string; readonly icon: LucideIcon }
> = {
  "approval-required": {
    label: "Supervised",
    description: "Ask before commands and file changes.",
    icon: LockIcon,
  },
  "auto-accept-edits": {
    label: "Auto-accept edits",
    description: "Auto-approve edits, ask before other actions.",
    icon: PenLineIcon,
  },
  "full-access": {
    label: "Full access",
    description: "Allow commands and edits without prompts.",
    icon: LockOpenIcon,
  },
};

export const runtimeModeOptions = Object.keys(runtimeModeConfig) as RuntimeMode[];

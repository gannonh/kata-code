import type { EnvironmentId } from "@kata-sh/code-contracts";
import { memo, useMemo } from "react";

import type { EnvironmentOption } from "./BranchToolbar.logic";
import { BranchToolbarEnvironmentIcon } from "./BranchToolbarEnvironmentIcon";
import {
  Select,
  SelectGroup,
  SelectGroupLabel,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "./ui/select";

interface BranchToolbarEnvironmentSelectorProps {
  envLocked: boolean;
  environmentId: EnvironmentId;
  availableEnvironments: readonly EnvironmentOption[];
  onEnvironmentChange?: (environmentId: EnvironmentId) => void;
}

export const BranchToolbarEnvironmentSelector = memo(function BranchToolbarEnvironmentSelector({
  envLocked,
  environmentId,
  availableEnvironments,
  onEnvironmentChange,
}: BranchToolbarEnvironmentSelectorProps) {
  const activeEnvironment = useMemo(() => {
    return availableEnvironments.find((env) => env.environmentId === environmentId) ?? null;
  }, [availableEnvironments, environmentId]);

  const environmentItems = useMemo(
    () =>
      availableEnvironments.map((env) => ({
        value: env.environmentId,
        label: env.label,
      })),
    [availableEnvironments],
  );

  const canSwitchEnvironment =
    !envLocked && availableEnvironments.length > 1 && onEnvironmentChange !== undefined;

  if (!canSwitchEnvironment) {
    return (
      <span
        data-testid="branch-toolbar-environment"
        className="inline-flex items-center gap-1 border border-transparent px-[calc(--spacing(3)-1px)] text-sm font-medium text-muted-foreground/70 sm:text-xs"
      >
        <BranchToolbarEnvironmentIcon
          kind={activeEnvironment?.iconKind ?? "cloud"}
          className="size-3"
        />
        {activeEnvironment?.label ?? "Run on"}
      </span>
    );
  }

  return (
    <Select
      modal={false}
      value={environmentId}
      onValueChange={(value) => onEnvironmentChange?.(value as EnvironmentId)}
      items={environmentItems}
    >
      <SelectTrigger
        data-testid="branch-toolbar-environment"
        variant="ghost"
        size="xs"
        className="font-medium"
        aria-label="Run on"
      >
        <BranchToolbarEnvironmentIcon
          kind={activeEnvironment?.iconKind ?? "cloud"}
          className="size-3"
        />
        <SelectValue />
      </SelectTrigger>
      <SelectPopup>
        <SelectGroup>
          <SelectGroupLabel>Run on</SelectGroupLabel>
          {availableEnvironments.map((env) => (
            <SelectItem key={env.environmentId} value={env.environmentId}>
              <span className="inline-flex items-center gap-1.5">
                <BranchToolbarEnvironmentIcon kind={env.iconKind} className="size-3" />
                {env.label}
              </span>
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectPopup>
    </Select>
  );
});

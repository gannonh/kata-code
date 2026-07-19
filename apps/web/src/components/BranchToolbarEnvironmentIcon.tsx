import { CloudIcon, ContainerIcon, MonitorIcon } from "lucide-react";

import type { EnvironmentIconKind } from "./BranchToolbar.logic";

interface BranchToolbarEnvironmentIconProps {
  kind: EnvironmentIconKind;
  className?: string;
}

export function BranchToolbarEnvironmentIcon({
  kind,
  className,
}: BranchToolbarEnvironmentIconProps) {
  const Icon = kind === "device" ? MonitorIcon : kind === "container" ? ContainerIcon : CloudIcon;
  return <Icon className={className} />;
}

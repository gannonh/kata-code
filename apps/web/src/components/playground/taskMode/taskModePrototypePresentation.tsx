import { AlertTriangleIcon, CheckCircle2Icon, CircleIcon, Loader2Icon } from "lucide-react";

import type { TaskModePrototypeStageStatus } from "./taskModePlaygroundFixtures";

export function statusBadgeVariant(
  status: TaskModePrototypeStageStatus,
): "success" | "info" | "warning" | "error" | "outline" {
  switch (status) {
    case "completed":
      return "success";
    case "running":
      return "info";
    case "waiting":
      return "warning";
    case "failed":
      return "error";
    case "historical":
    case "upcoming":
      return "outline";
  }
}

export function statusLabel(status: TaskModePrototypeStageStatus): string {
  switch (status) {
    case "completed":
      return "Complete";
    case "running":
      return "Working";
    case "waiting":
      return "Waiting";
    case "failed":
      return "Blocked";
    case "historical":
      return "Historical";
    case "upcoming":
      return "Upcoming";
  }
}

export function StageStatusIcon({ status }: { readonly status: TaskModePrototypeStageStatus }) {
  switch (status) {
    case "completed":
      return <CheckCircle2Icon className="size-4 text-success-foreground" />;
    case "running":
      return <Loader2Icon className="size-4 animate-spin text-info-foreground" />;
    case "waiting":
      return <CircleIcon className="size-4 fill-warning text-warning-foreground" />;
    case "failed":
      return <AlertTriangleIcon className="size-4 text-destructive" />;
    case "historical":
      return <CheckCircle2Icon className="size-4 text-muted-foreground" />;
    case "upcoming":
      return <CircleIcon className="size-4 text-muted-foreground/45" />;
  }
}

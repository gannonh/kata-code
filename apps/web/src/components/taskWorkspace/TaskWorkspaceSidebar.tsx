import { Link, useLocation } from "@tanstack/react-router";
import { CheckCircle2Icon, ClipboardListIcon, PlusIcon } from "lucide-react";
import { useShallow } from "zustand/react/shallow";

import {
  currentTaskStage,
  selectTaskWorkspaces,
  useTaskWorkspaceStore,
} from "../../taskWorkspace/taskWorkspaceStore";
import { Badge } from "../ui/badge";
import { SidebarGroup, SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "../ui/sidebar";

export function TaskWorkspaceSidebar() {
  const pathname = useLocation({ select: (location) => location.pathname });
  const tasks = useTaskWorkspaceStore(useShallow(selectTaskWorkspaces));

  return (
    <SidebarGroup className="shrink-0 gap-1 border-b border-border/70 px-2 pb-2 pt-1.5">
      <div className="flex items-center justify-between px-2 py-1">
        <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/75">
          <ClipboardListIcon className="size-3.5" />
          Tasks
        </span>
        <SidebarMenuButton
          size="sm"
          className="size-6 justify-center p-0"
          tooltip="New task"
          render={<Link to="/tasks/new" aria-label="New task" />}
        >
          <PlusIcon className="size-3.5" />
        </SidebarMenuButton>
      </div>
      <SidebarMenu className="max-h-40 overflow-auto">
        {tasks.length === 0 ? (
          <SidebarMenuItem>
            <SidebarMenuButton
              size="sm"
              className="text-muted-foreground"
              render={<Link to="/tasks/new" />}
            >
              <PlusIcon className="size-3.5" />
              Create first task
            </SidebarMenuButton>
          </SidebarMenuItem>
        ) : (
          tasks.map((task) => {
            const stage = currentTaskStage(task);
            const active = pathname === `/tasks/${task.id}`;
            return (
              <SidebarMenuItem key={task.id}>
                <SidebarMenuButton
                  size="sm"
                  isActive={active}
                  className="gap-2"
                  render={<Link to="/tasks/$taskId" params={{ taskId: task.id }} />}
                >
                  {stage === "verified" ? (
                    <CheckCircle2Icon className="size-3.5 text-success-foreground" />
                  ) : (
                    <ClipboardListIcon className="size-3.5" />
                  )}
                  <span className="min-w-0 flex-1 truncate">{task.title}</span>
                  <Badge
                    size="sm"
                    variant={stage === "verified" ? "success" : "outline"}
                    className="max-w-20 truncate"
                  >
                    {stage}
                  </Badge>
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          })
        )}
      </SidebarMenu>
    </SidebarGroup>
  );
}

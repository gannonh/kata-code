import {
  BotIcon,
  ClipboardListIcon,
  MessageSquareIcon,
  PlusIcon,
  SearchIcon,
  SparklesIcon,
} from "lucide-react";

import { Button } from "../../ui/button";
import type {
  TaskModePrototypeScenario,
  TaskModePrototypeStage,
} from "./taskModePlaygroundFixtures";

function taskStatusDotClass(taskStatus: TaskModePrototypeScenario["taskStatus"]): string {
  switch (taskStatus) {
    case "working":
      return "bg-info";
    case "waiting":
      return "bg-warning";
    case "blocked":
      return "bg-destructive";
  }
}

export function TaskModePrototypeSidebar({
  activeStage,
  taskStatus,
  variant = "desktop",
}: {
  readonly activeStage: TaskModePrototypeStage;
  readonly taskStatus: TaskModePrototypeScenario["taskStatus"];
  readonly variant?: "desktop" | "mobile";
}) {
  return (
    <aside
      data-testid="task-mode-prototype-sidebar"
      className={
        variant === "mobile"
          ? "flex h-full w-full flex-col bg-card"
          : "hidden w-64 shrink-0 flex-col border-r border-border bg-card md:flex"
      }
    >
      <div className="flex h-14 items-center gap-2 border-b border-border px-4">
        <div className="grid size-7 place-items-center rounded-lg bg-foreground text-background">
          <SparklesIcon className="size-4" />
        </div>
        <span className="text-sm font-semibold">Kata Code</span>
      </div>

      <div className="space-y-5 overflow-auto p-3">
        <Button className="w-full justify-start" size="sm" variant="outline">
          <PlusIcon className="size-4" />
          New conversation
        </Button>

        <section className="space-y-1.5">
          <div className="flex items-center justify-between px-2">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Tasks
            </p>
            <PlusIcon aria-hidden="true" className="size-3.5 text-muted-foreground" />
          </div>
          <button
            type="button"
            className="w-full rounded-lg bg-accent px-2.5 py-2 text-left"
            aria-current="page"
            data-testid="task-mode-prototype-task-row"
          >
            <div className="flex items-center gap-2">
              <ClipboardListIcon className="size-4 shrink-0" />
              <span className="min-w-0 flex-1 truncate text-sm font-medium">
                Refine Task mode UX
              </span>
            </div>
            <div className="mt-1.5 flex items-center gap-1.5 pl-6">
              <span className={`size-1.5 rounded-full ${taskStatusDotClass(taskStatus)}`} />
              <span className="text-[11px] text-muted-foreground">{activeStage.label}</span>
              <span className="text-[11px] text-muted-foreground/60">·</span>
              <span className="text-[11px] capitalize text-muted-foreground">{taskStatus}</span>
            </div>
          </button>
          <button
            type="button"
            className="w-full rounded-lg px-2.5 py-2 text-left hover:bg-accent/60"
          >
            <div className="flex items-center gap-2">
              <ClipboardListIcon className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate text-sm">Ship settings redesign</span>
            </div>
            <p className="mt-1 pl-6 text-[11px] text-muted-foreground">Implement · idle</p>
          </button>
        </section>

        <section className="space-y-1.5">
          <div className="flex items-center justify-between px-2">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Chats
            </p>
            <SearchIcon aria-hidden="true" className="size-3.5 text-muted-foreground" />
          </div>
          {["Review provider errors", "Explore command palette", "Release notes"].map(
            (title, index) => (
              <button
                key={title}
                type="button"
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-muted-foreground hover:bg-accent/60 hover:text-foreground"
              >
                {index === 0 ? (
                  <BotIcon className="size-4 shrink-0" />
                ) : (
                  <MessageSquareIcon className="size-4 shrink-0" />
                )}
                <span className="truncate">{title}</span>
              </button>
            ),
          )}
        </section>
      </div>

      <div className="mt-auto border-t border-border p-3">
        <div className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-muted-foreground">
          <div className="size-2 rounded-full bg-success" />
          Local environment
        </div>
      </div>
    </aside>
  );
}

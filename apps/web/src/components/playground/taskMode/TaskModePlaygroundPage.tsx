import { Link } from "@tanstack/react-router";
import { Columns3Icon, Rows3Icon } from "lucide-react";
import { useState } from "react";

import { Button } from "../../ui/button";
import { TaskModePrototype, type TaskModePrototypeLayout } from "./TaskModePrototype";
import {
  getTaskModePrototypeScenario,
  listTaskModePrototypeScenarios,
  type TaskModePrototypeScenarioId,
} from "./taskModePlaygroundFixtures";

const LAYOUTS: ReadonlyArray<{
  readonly id: TaskModePrototypeLayout;
  readonly label: string;
  readonly description: string;
}> = [
  {
    id: "current-refined",
    label: "Refined current",
    description: "Conversation plus persistent right Task panel",
  },
  {
    id: "horizontal-stages",
    label: "Horizontal stages",
    description: "Top workflow rail plus optional details inspector",
  },
];

export function TaskModePlaygroundPage() {
  const [scenarioId, setScenarioId] = useState<TaskModePrototypeScenarioId>("design-running");
  const [layout, setLayout] = useState<TaskModePrototypeLayout>("current-refined");
  const scenario = getTaskModePrototypeScenario(scenarioId);

  return (
    <div className="flex h-dvh min-h-0 flex-col bg-background text-foreground">
      <header
        className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border bg-card px-3 py-2 sm:px-4"
        data-testid="task-mode-playground-controls"
      >
        <div className="flex min-w-0 items-center gap-3">
          <Link
            to="/playground"
            className="shrink-0 text-xs text-muted-foreground hover:text-foreground"
          >
            ← Playground
          </Link>
          <div className="hidden h-5 w-px bg-border sm:block" />
          <div className="hidden min-w-0 sm:block">
            <p className="truncate text-xs font-semibold">Task mode UX</p>
            <p className="truncate text-[10px] text-muted-foreground">
              Fixture-only design exploration
            </p>
          </div>
        </div>

        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="hidden lg:inline">Scenario</span>
            <select
              aria-label="Scenario"
              data-testid="task-mode-scenario-select"
              className="h-8 max-w-48 rounded-lg border border-input bg-background px-2 text-xs text-foreground"
              value={scenarioId}
              onChange={(event) =>
                setScenarioId(event.currentTarget.value as TaskModePrototypeScenarioId)
              }
            >
              {listTaskModePrototypeScenarios().map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.label}
                </option>
              ))}
            </select>
          </label>

          <div className="flex rounded-lg border border-border bg-background p-0.5">
            {LAYOUTS.map((candidate) => {
              const isActive = layout === candidate.id;
              return (
                <Button
                  key={candidate.id}
                  aria-pressed={isActive}
                  data-testid={`task-mode-layout-option-${candidate.id}`}
                  data-active={isActive || undefined}
                  size="xs"
                  variant={isActive ? "secondary" : "ghost"}
                  title={candidate.description}
                  onClick={() => setLayout(candidate.id)}
                >
                  {candidate.id === "current-refined" ? (
                    <Columns3Icon className="size-3.5" />
                  ) : (
                    <Rows3Icon className="size-3.5" />
                  )}
                  <span className="hidden md:inline">{candidate.label}</span>
                </Button>
              );
            })}
          </div>
        </div>
      </header>

      <div className="flex min-h-0 flex-1" title={scenario.description}>
        <TaskModePrototype key={`${scenarioId}:${layout}`} scenario={scenario} layout={layout} />
      </div>
    </div>
  );
}

import { Link } from "@tanstack/react-router";
import { useState } from "react";

import { TaskModePrototype } from "./TaskModePrototype";
import {
  getTaskModePrototypeScenario,
  listTaskModePrototypeScenarios,
  type TaskModePrototypeScenarioId,
} from "./taskModePlaygroundFixtures";

export function TaskModePlaygroundPage() {
  const [scenarioId, setScenarioId] = useState<TaskModePrototypeScenarioId>("design-running");
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
            <p className="truncate text-xs font-semibold">Task mode · Prototype A</p>
            <p className="truncate text-[10px] text-muted-foreground">{scenario.description}</p>
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

          <span className="rounded-md border border-primary/30 bg-primary/5 px-2 py-1 text-[11px] font-medium text-primary">
            Accepted shell
          </span>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <TaskModePrototype key={scenarioId} scenario={scenario} layout="current-refined" />
      </div>
    </div>
  );
}

import {
  ModelSelection,
  ProviderInstanceId,
  Routine,
  isScheduleTrigger,
  type EnvironmentId,
  type ServerProvider,
} from "@kata-sh/code-contracts";
import { useAtomValue } from "@effect/atom-react";
import * as Schema from "effect/Schema";
import {
  CalendarClockIcon,
  ChevronDownIcon,
  Clock3Icon,
  PlusIcon,
  Settings2Icon,
  SquareKanbanIcon,
  WebhookIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { routineEnvironment } from "../../state/routines";
import { serverEnvironment } from "../../state/server";
import { useProjects } from "../../state/entities";
import { useEnvironments, usePrimaryEnvironmentId } from "../../state/environments";
import { useEnvironmentQuery } from "../../state/query";
import { cn } from "../../lib/utils";
import { Button } from "../../components/ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../../components/ui/menu";
import { SidebarInset } from "../../components/ui/sidebar";
import { WorkspacePageHeader } from "../../components/WorkspacePageHeader";
import { Badge } from "../../components/ui/badge";
import { Empty, EmptyHeader, EmptyTitle } from "../../components/ui/empty";
import {
  enabledProviders,
  firstEnabledProviderModel,
  formatRoutineTrigger,
  keepDeletedRoutineInEditor,
  libraryRoutinesAfterChange,
  newRoutineDraftId,
  routineDraftBaselineAfterAutomaticChange,
  routineDraftRevisionAfterEdit,
  routinesLibraryEmptyKind,
  worktreeWorkspace,
  type RoutineEditorDraft,
} from "./RoutinesPage.logic";
import { RoutineChat } from "./RoutineChat";
import { RoutineEditor, type DraftState, type RoutineWithOwner } from "./RoutineEditor";

const decodeModelSelection = Schema.decodeUnknownSync(ModelSelection);

type EnvironmentRoutineLoad = {
  readonly status: "ready" | "unavailable" | "pending";
  readonly routines: readonly RoutineWithOwner[];
};

const EMPTY_ROUTINES: readonly RoutineWithOwner[] = [];

function defaultDraft(
  environmentId: EnvironmentId,
  projects: readonly ReturnType<typeof useProjects>[number][],
  providers: readonly ServerProvider[],
  baseBranch = "main",
): DraftState | null {
  const project = projects.find((candidate) => candidate.environmentId === environmentId);
  if (!project) return null;
  const workspace =
    project.repositoryIdentity !== null
      ? worktreeWorkspace(baseBranch)
      : { kind: "shared" as const, directory: project.workspaceRoot };
  return {
    id: newRoutineDraftId(),
    environmentId,
    expectedRevision: 0,
    configuration: {
      name: "",
      instruction: "",
      projectId: project.id,
      modelSelection:
        firstEnabledProviderModel(providers) ??
        decodeModelSelection({
          instanceId: ProviderInstanceId.make("codex"),
          model: "gpt-5.4",
        }),
      runtimeMode: "approval-required",
      workspace,
      trigger: { kind: "daily", time: "09:00", timezone: "UTC" },
    },
  };
}

function RoutineEnvironmentRows({
  environmentId,
  ownerLabel,
  connectionPhase,
  onLoaded,
}: {
  readonly environmentId: EnvironmentId;
  readonly ownerLabel: string;
  readonly connectionPhase: string;
  readonly onLoaded: (environmentId: EnvironmentId, load: EnvironmentRoutineLoad) => void;
}) {
  const query = useEnvironmentQuery(routineEnvironment.list({ environmentId, input: {} }));
  useEffect(() => {
    if (query.data !== null) {
      onLoaded(environmentId, {
        status: "ready",
        routines: query.data.map((routine) => ({
          ...routine,
          environmentId,
          ownerLabel,
          connectionPhase,
        })),
      });
      return;
    }
    if (query.error !== null || (connectionPhase !== "connected" && !query.isPending)) {
      onLoaded(environmentId, { status: "unavailable", routines: EMPTY_ROUTINES });
      return;
    }
    onLoaded(environmentId, { status: "pending", routines: EMPTY_ROUTINES });
  }, [
    connectionPhase,
    environmentId,
    onLoaded,
    ownerLabel,
    query.data,
    query.error,
    query.isPending,
  ]);
  return null;
}

function RoutineCard({
  routine,
  projectLabel,
  selected,
  onSelect,
}: {
  readonly routine: RoutineWithOwner;
  readonly projectLabel: string;
  readonly selected: boolean;
  readonly onSelect: () => void;
}) {
  const offline = routine.connectionPhase !== "connected";
  return (
    <button
      type="button"
      className={cn(
        "group min-w-0 rounded-xl border p-3 text-left transition-colors focus-visible:ring-2 focus-visible:ring-ring",
        selected
          ? "border-primary/60 bg-primary/8 shadow-sm"
          : "border-border/60 bg-card/40 hover:border-border hover:bg-card/75",
        offline && "opacity-75",
      )}
      onClick={onSelect}
      aria-pressed={selected}
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-background/75 text-muted-foreground ring-1 ring-border/50">
          {routine.configuration.trigger.kind === "linear" ? (
            <SquareKanbanIcon className="size-4" />
          ) : isScheduleTrigger(routine.configuration.trigger) ? (
            <Clock3Icon className="size-4" />
          ) : (
            <WebhookIcon className="size-4" />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center justify-between gap-2">
            <span className="truncate text-sm font-semibold text-foreground">
              {routine.configuration.name}
            </span>
            {offline ? (
              <Badge variant="outline" size="sm">
                Offline
              </Badge>
            ) : null}
          </span>
          <span className="mt-1 block truncate text-xs text-muted-foreground">
            {formatRoutineTrigger(routine.configuration.trigger)}
          </span>
          <span className="mt-1 block truncate text-xs text-muted-foreground/70">
            {routine.ownerLabel} · {projectLabel}
          </span>
          <span className="mt-1 block truncate text-xs text-muted-foreground/70">
            {routine.configuration.workspace.kind === "worktree" ? "Worktree" : "Shared folder"}
          </span>
        </span>
      </div>
    </button>
  );
}

export function RoutinesPage() {
  const { environments, isReady } = useEnvironments();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const projects = useProjects();
  const [routinesByEnvironment, setRoutinesByEnvironment] = useState<
    ReadonlyMap<EnvironmentId, EnvironmentRoutineLoad>
  >(new Map());
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [editing, setEditing] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [editorRoutine, setEditorRoutine] = useState<RoutineWithOwner | null>(null);
  const [baseline, setBaseline] = useState<RoutineEditorDraft | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatRevision, setChatRevision] = useState(0);
  const [generationModelSelection, setGenerationModelSelection] = useState<ModelSelection | null>(
    null,
  );
  const newRoutineTriggerRef = useRef<HTMLButtonElement | null>(null);
  const allRoutines = useMemo(
    () => Array.from(routinesByEnvironment.values()).flatMap((load) => load.routines),
    [routinesByEnvironment],
  );
  const libraryEmptyKind = routinesLibraryEmptyKind({
    routineCount: allRoutines.length,
    unavailableCount: Array.from(routinesByEnvironment.values()).filter(
      (load) => load.status === "unavailable",
    ).length,
    pendingCount: Array.from(routinesByEnvironment.values()).filter(
      (load) => load.status === "pending",
    ).length,
  });
  const selectedRoutine =
    allRoutines.find((routine) => `${routine.environmentId}:${routine.id}` === selectedKey) ??
    (editorRoutine !== null && `${editorRoutine.environmentId}:${editorRoutine.id}` === selectedKey
      ? editorRoutine
      : null);
  const selectedEnvironment = environments.find(
    (environment) =>
      environment.environmentId === (draft?.environmentId ?? selectedRoutine?.environmentId),
  );
  const selectedProviders = useAtomValue(
    serverEnvironment.providersValueAtom(
      draft?.environmentId ??
        selectedRoutine?.environmentId ??
        primaryEnvironmentId ??
        environments[0]?.environmentId ??
        ("" as EnvironmentId),
    ),
  );
  const connectedOwners = environments.filter(
    (environment) =>
      environment.connection.phase === "connected" &&
      projects.some((project) => project.environmentId === environment.environmentId),
  );
  const saveDraftEnvironment =
    draft?.environmentId ??
    (connectedOwners.some((owner) => owner.environmentId === selectedRoutine?.environmentId)
      ? selectedRoutine?.environmentId
      : null) ??
    (connectedOwners.some((owner) => owner.environmentId === primaryEnvironmentId)
      ? primaryEnvironmentId
      : null) ??
    connectedOwners[0]?.environmentId ??
    null;

  const onLoaded = useCallback((environmentId: EnvironmentId, load: EnvironmentRoutineLoad) => {
    setRoutinesByEnvironment((previous) => new Map(previous).set(environmentId, load));
  }, []);

  const startNew = (mode: "manual" | "chat" = "manual") => {
    if (connectedOwners.length === 0) {
      setCreateError("Import a project on a connected environment before creating a routine.");
      setShowMenu(false);
      setEditing(false);
      setDraft(null);
      setEditorRoutine(null);
      setBaseline(null);
      setChatOpen(false);
      setGenerationModelSelection(null);
      setChatRevision(0);
      return;
    }
    setCreateError(null);
    setShowMenu(false);
    setSelectedKey(null);
    setDraft(null);
    setEditorRoutine(null);
    setBaseline(null);
    setChatOpen(mode === "chat");
    setGenerationModelSelection(null);
    setChatRevision(0);
    setEditing(true);
  };

  useEffect(() => {
    if (!editing || draft !== null || saveDraftEnvironment === null) return;
    const environmentId = saveDraftEnvironment;
    const environmentProjects = projects.filter(
      (project) => project.environmentId === environmentId,
    );
    const providers = selectedProviders ?? [];
    const next = defaultDraft(environmentId, environmentProjects, providers);
    if (next) {
      setCreateError(null);
      setDraft(next);
      setBaseline(next.configuration);
      setChatRevision(0);
      if (chatOpen && generationModelSelection === null) {
        setGenerationModelSelection(firstEnabledProviderModel(providers));
      }
      return;
    }
    setEditing(false);
    setCreateError("Import a project on a connected environment before creating a routine.");
  }, [
    chatOpen,
    draft,
    editing,
    generationModelSelection,
    projects,
    saveDraftEnvironment,
    selectedProviders,
  ]);

  useEffect(() => {
    if (!chatOpen || generationModelSelection !== null) return;
    const firstModel = firstEnabledProviderModel(selectedProviders ?? []);
    if (firstModel !== null) setGenerationModelSelection(firstModel);
  }, [chatOpen, generationModelSelection, selectedProviders]);

  const changeOwner = (environmentId: EnvironmentId) => {
    if (!draft) return;
    if (environmentId === draft.environmentId) return;
    setChatRevision((revision) => revision + 1);
    setDraft({ ...draft, environmentId });
  };

  useEffect(() => {
    if (!editing || draft === null || selectedRoutine !== null) return;
    const environmentProjects = projects.filter(
      (project) => project.environmentId === draft.environmentId,
    );
    const projectOk = environmentProjects.some(
      (project) => project.id === draft.configuration.projectId,
    );
    const providerOk = enabledProviders(selectedProviders ?? []).some(
      (candidate) => candidate.instanceId === draft.configuration.modelSelection.instanceId,
    );
    if (projectOk && (providerOk || enabledProviders(selectedProviders ?? []).length === 0)) return;
    const next = defaultDraft(draft.environmentId, environmentProjects, selectedProviders ?? []);
    if (!next) return;
    const nextConfiguration = {
      ...next.configuration,
      name: draft.configuration.name,
      instruction: draft.configuration.instruction,
    };
    setChatRevision((revision) =>
      routineDraftRevisionAfterEdit(draft.configuration, nextConfiguration, revision),
    );
    setDraft({
      ...next,
      id: draft.id,
      configuration: nextConfiguration,
    });
    if (baseline) {
      setBaseline(
        routineDraftBaselineAfterAutomaticChange(draft.configuration, baseline, nextConfiguration),
      );
    }
  }, [baseline, draft, editing, projects, selectedProviders, selectedRoutine]);

  const selectRoutine = (routine: RoutineWithOwner) => {
    setSelectedKey(`${routine.environmentId}:${routine.id}`);
    setDraft({
      id: routine.id,
      environmentId: routine.environmentId,
      expectedRevision: routine.revision,
      configuration: routine.configuration,
    });
    setEditing(true);
    setShowMenu(false);
    setEditorRoutine(routine);
    setBaseline(routine.configuration);
    setChatOpen(false);
    setGenerationModelSelection(null);
    setChatRevision(0);
  };

  const cancelEditing = () => {
    setEditing(false);
    setDraft(null);
    setSelectedKey(null);
    setCreateError(null);
    setEditorRoutine(null);
    setBaseline(null);
    setChatOpen(false);
    setGenerationModelSelection(null);
    setChatRevision(0);
    queueMicrotask(() => newRoutineTriggerRef.current?.focus());
  };

  const updateDraft = (next: DraftState) => {
    if (draft !== null) {
      setChatRevision((revision) =>
        routineDraftRevisionAfterEdit(draft.configuration, next.configuration, revision),
      );
    }
    setDraft(next);
  };

  const updateDraftConfiguration = (configuration: RoutineEditorDraft) => {
    if (draft === null) return;
    updateDraft({ ...draft, configuration });
  };

  const ownerOffline = selectedEnvironment?.connection.phase !== "connected";
  const updateSavedRoutine = (routine: Routine) => {
    setDraft({
      id: routine.id,
      environmentId: routine.environmentId,
      expectedRevision: routine.revision,
      configuration: routine.configuration,
    });
    setBaseline(routine.configuration);
    setChatRevision(0);
    setSelectedKey(`${routine.environmentId}:${routine.id}`);
    setEditing(routine.state !== "deleted" || keepDeletedRoutineInEditor(routine.state));
    setRoutinesByEnvironment((previous) => {
      const next = new Map(previous);
      const existing = next.get(routine.environmentId);
      const currentRoutines = existing?.routines ?? [];
      const owner =
        currentRoutines.find((entry) => entry.id === routine.id) ??
        (editorRoutine?.id === routine.id ? editorRoutine : undefined);
      const replacement: RoutineWithOwner = {
        ...routine,
        ownerLabel: owner?.ownerLabel ?? "Environment",
        connectionPhase: owner?.connectionPhase ?? "connected",
      };
      next.set(routine.environmentId, {
        status: existing?.status ?? "ready",
        routines: libraryRoutinesAfterChange(currentRoutines, replacement),
      });
      return next;
    });
    setEditorRoutine((previous) => ({
      ...routine,
      ownerLabel: previous?.id === routine.id ? previous.ownerLabel : "Environment",
      connectionPhase: previous?.id === routine.id ? previous.connectionPhase : "connected",
    }));
  };

  if (!isReady)
    return (
      <SidebarInset className="min-h-0">
        <Empty>
          <EmptyHeader>
            <EmptyTitle>Loading routines…</EmptyTitle>
          </EmptyHeader>
        </Empty>
      </SidebarInset>
    );

  return (
    <SidebarInset className="min-h-0 overflow-auto">
      <WorkspacePageHeader className="border-b border-border/60">
        <div className="flex items-center gap-2 text-sm">
          <span className="font-medium text-foreground">Routines</span>
          <span className="text-muted-foreground/60">/</span>
          <span className="text-muted-foreground">All projects</span>
        </div>
      </WorkspacePageHeader>
      <main className="mx-auto w-full max-w-5xl px-4 py-7 sm:px-8 sm:py-10">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Routines</h1>
            <p className="mt-1 max-w-lg text-sm text-muted-foreground">
              Prompts that run on a schedule. Each routine stays owned by the environment where it
              was saved.
            </p>
          </div>
          <Menu open={showMenu} onOpenChange={setShowMenu}>
            <MenuTrigger render={<Button ref={newRoutineTriggerRef} aria-expanded={showMenu} />}>
              <PlusIcon className="size-4" /> New routine <ChevronDownIcon className="size-3.5" />
            </MenuTrigger>
            <MenuPopup align="end" className="w-48">
              <MenuItem onClick={() => startNew("manual")}>
                <Settings2Icon className="size-4 text-muted-foreground" /> Set up manually
              </MenuItem>
              <MenuItem onClick={() => startNew("chat")}>
                <CalendarClockIcon className="size-4 text-muted-foreground" /> Create in chat
              </MenuItem>
            </MenuPopup>
          </Menu>
        </div>
        {createError ? (
          <div className="mt-4 rounded-lg border border-warning/30 bg-warning/8 px-3 py-2 text-xs text-warning-foreground">
            {createError}
          </div>
        ) : null}
        <div className="mt-7 grid gap-3 sm:grid-cols-2">
          {environments.map((environment) => (
            <RoutineEnvironmentRows
              key={environment.environmentId}
              environmentId={environment.environmentId}
              ownerLabel={environment.label}
              connectionPhase={environment.connection.phase}
              onLoaded={onLoaded}
            />
          ))}
          {libraryEmptyKind === "pending" ? (
            <div className="col-span-full rounded-xl border border-dashed border-border/70 px-6 py-12 text-center">
              <p className="text-sm font-medium">Loading routines…</p>
            </div>
          ) : libraryEmptyKind === "unavailable" ? (
            <div className="col-span-full rounded-xl border border-dashed border-border/70 px-6 py-12 text-center">
              <CalendarClockIcon className="mx-auto size-8 text-muted-foreground/60" />
              <p className="mt-3 text-sm font-medium">Environments unavailable</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Saved routines stay on their owning machine and will appear when it reconnects.
              </p>
            </div>
          ) : libraryEmptyKind === "empty" ? (
            <div className="col-span-full rounded-xl border border-dashed border-border/70 px-6 py-12 text-center">
              <CalendarClockIcon className="mx-auto size-8 text-muted-foreground/60" />
              <p className="mt-3 text-sm font-medium">No routines yet</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Create a manual routine to run a saved prompt later.
              </p>
            </div>
          ) : (
            allRoutines.map((routine) => {
              const project = projects.find(
                (candidate) =>
                  candidate.environmentId === routine.environmentId &&
                  candidate.id === routine.configuration.projectId,
              );
              const projectLabel = project
                ? `${project.title} · ${project.workspaceRoot}`
                : String(routine.configuration.projectId);
              return (
                <RoutineCard
                  key={`${routine.environmentId}:${routine.id}`}
                  routine={routine}
                  projectLabel={projectLabel}
                  selected={selectedKey === `${routine.environmentId}:${routine.id}`}
                  onSelect={() => selectRoutine(routine)}
                />
              );
            })
          )}
        </div>
        {editing && draft ? (
          <>
            {chatOpen ? (
              <RoutineChat
                key={draft.id}
                draft={draft}
                draftRevision={chatRevision}
                providers={selectedProviders ?? []}
                generationModelSelection={generationModelSelection}
                onGenerationModelChange={setGenerationModelSelection}
                onDraftChange={updateDraftConfiguration}
                onCancel={cancelEditing}
              />
            ) : null}
            <RoutineEditor
              draft={draft}
              routine={selectedRoutine}
              projects={projects.filter((project) => project.environmentId === draft.environmentId)}
              providers={selectedProviders ?? []}
              owners={connectedOwners.map((owner) => ({
                environmentId: owner.environmentId,
                label: owner.label,
              }))}
              offline={ownerOffline === true}
              baseline={baseline ?? draft.configuration}
              onDraftChange={updateDraft}
              onBaselineChange={setBaseline}
              onOwnerChange={changeOwner}
              onSaved={updateSavedRoutine}
              onCancel={cancelEditing}
            />
          </>
        ) : null}
      </main>
    </SidebarInset>
  );
}

"use client";

import { ChevronDownIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import {
  SandboxProviderDriverKind,
  type ProviderInstanceEnvironmentVariable,
  type SavedSandboxEnvironmentMap,
  type SandboxInstanceSummary,
  type SandboxProviderInstanceConfig,
} from "@kata-sh/code-contracts";

import { useSavedEnvironmentRegistryStore } from "../../environments/runtime";
import { cn } from "../../lib/utils";
import type { Project } from "../../types";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Collapsible, CollapsibleContent } from "../ui/collapsible";
import { DraftInput } from "../ui/draft-input";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { ProviderEnvironmentSection } from "./ProviderInstanceCard";
import { ProviderSignInDialog } from "./ProviderSignInDialog";
import { DockerConfigFields, VercelConfigFields } from "./SandboxDriverConfigFields";
import {
  canCreateGitHubSourcedSandbox,
  readSandboxGitHubSource,
  setSandboxGitHubSource,
  type SandboxListUiState,
  sandboxGitHubSourceRepositoryKey,
} from "./SandboxDeploymentSettings.logic";
import { SavedEnvironmentEditor } from "./SavedEnvironmentEditor";
import { SandboxGitHubSourcePicker } from "./SandboxGitHubSourcePicker";

const VERCEL_KIND = SandboxProviderDriverKind.make("vercel");
const DOCKER_KIND = SandboxProviderDriverKind.make("docker");
const VERCEL_REQUIRED_ENV_NAMES = ["VERCEL_TOKEN", "VERCEL_TEAM_ID", "VERCEL_PROJECT_ID"] as const;
type BusyOp = "test" | "start" | "dispose" | "renew" | "stop";

interface DeploymentTargetCardProps {
  readonly instanceId: string;
  readonly instance: SandboxProviderInstanceConfig;
  readonly displayName: string;
  readonly available: boolean;
  readonly reason: string | undefined;
  readonly session: { environmentId: string; httpBaseUrl: string } | undefined;
  readonly summary: SandboxInstanceSummary | undefined;
  /** Environments list fetch phase — keeps Create/Test from looking silently dead. */
  readonly listUiState: SandboxListUiState;
  readonly progress: string[];
  readonly instanceBusy: BusyOp | undefined;
  readonly isExpanded: boolean;
  readonly projects: ReadonlyArray<Project>;
  readonly savedSandboxEnvironments: SavedSandboxEnvironmentMap | undefined;
  readonly selectedRepositoryKey: string | undefined;
  readonly onExpandedChange: (open: boolean) => void;
  readonly onUpdate: (next: SandboxProviderInstanceConfig) => void;
  readonly onSavedEnvironmentChange: (next: SavedSandboxEnvironmentMap) => void;
  readonly onSelectedRepositoryKeyChange: (repositoryKey: string) => void;
  readonly onDelete: () => void;
  readonly onTest: () => void;
  readonly onStart: () => void;
  readonly onStop: () => void;
  readonly onDispose: () => void;
  readonly onRenew: () => void;
  readonly onRetryPairing: () => void;
}

/**
 * A single deployment-target row: title + driver/status badges + delete +
 * status badge + secondary Stop/Start button + chevron in the header, and a
 * `Collapsible` with display name, config fields, env vars, and state-driven
 * actions (Create & run sandbox / Stop / Start / Delete sandbox) + progress.
 */
export function DeploymentTargetCard({
  instanceId,
  instance,
  displayName,
  available,
  reason,
  session,
  summary,
  listUiState,
  progress,
  instanceBusy,
  isExpanded,
  projects,
  savedSandboxEnvironments,
  selectedRepositoryKey,
  onExpandedChange,
  onUpdate,
  onSavedEnvironmentChange,
  onSelectedRepositoryKeyChange,
  onDelete,
  onTest,
  onStart,
  onStop,
  onDispose,
  onRenew,
  onRetryPairing,
}: DeploymentTargetCardProps) {
  const isVercel = (instance.driver as string) === (VERCEL_KIND as string);
  const isDocker = (instance.driver as string) === (DOCKER_KIND as string);
  const usesGitHubSource =
    summary?.kind === "available" ? summary.supportsProjectSource === true : isVercel || isDocker;
  const runningSession = summary?.kind === "available" ? summary.runningSession : undefined;
  const supportsRenewTimeout =
    summary?.kind === "available" ? summary.supportsRenewTimeout : undefined;
  const sessionStatus = runningSession?.status;
  const deadlineEpochMs = runningSession?.deadlineEpochMs;
  const statusDetail = runningSession?.statusDetail;
  const [signInFor, setSignInFor] = useState<string | null>(null);
  // Recovery R2: a running sandbox whose environment id has no saved record
  // is unreachable from Add Project — offer Retry pairing instead of a dead end.
  const hasSavedRecordForSession = useSavedEnvironmentRegistryStore((state) =>
    runningSession !== undefined && sessionStatus === "running"
      ? state.byId[runningSession.environmentId as never] !== undefined
      : true,
  );
  const updateDisplayName = (value: string) => {
    const trimmed = value.trim();
    const { displayName: _omit, ...rest } = instance;
    onUpdate(
      trimmed.length > 0
        ? ({ ...rest, displayName: trimmed } as SandboxProviderInstanceConfig)
        : (rest as SandboxProviderInstanceConfig),
    );
  };

  const updateConfig = (nextConfig: Record<string, unknown> | undefined) => {
    const { config: _omit, ...rest } = instance;
    onUpdate(
      nextConfig !== undefined
        ? ({ ...rest, config: nextConfig } as SandboxProviderInstanceConfig)
        : (rest as SandboxProviderInstanceConfig),
    );
  };

  const updateEnvironment = (environment: ReadonlyArray<ProviderInstanceEnvironmentVariable>) => {
    const cleaned = environment.filter((variable) => variable.name.trim().length > 0);
    const { environment: _omit, ...rest } = instance;
    onUpdate(
      cleaned.length > 0
        ? ({ ...rest, environment: cleaned } as SandboxProviderInstanceConfig)
        : (rest as SandboxProviderInstanceConfig),
    );
  };

  // GitHub source selection (repository + branch) for Docker and Vercel. The
  // source is locked once a sandbox exists; creation requires a complete source.
  const githubSource = usesGitHubSource ? readSandboxGitHubSource(instance.config) : null;
  const sourceLocked = usesGitHubSource && sessionStatus !== undefined;
  const githubSourceKey = githubSource
    ? sandboxGitHubSourceRepositoryKey(githubSource.repository)
    : undefined;
  const createDisabledForSource = !canCreateGitHubSourcedSandbox({
    requiresGitHubSource: usesGitHubSource,
    config: instance.config,
  });
  const actionsBlocked = listUiState !== "ready" || instanceBusy !== undefined;
  const createBlocked = actionsBlocked || !available || createDisabledForSource;

  const setSource = (next: { repository?: string; branch?: string }) => {
    const { config: _omit, ...rest } = instance;
    const nextConfig = setSandboxGitHubSource(instance.config, next);
    const nextInstance =
      nextConfig !== undefined
        ? ({ ...rest, config: nextConfig } as SandboxProviderInstanceConfig)
        : (rest as SandboxProviderInstanceConfig);
    // Keep the settings envelope repositoryKey aligned with the source so saved
    // per-repo settings key consistently with the server derivation.
    const source = nextConfig ? readSandboxGitHubSource(nextConfig) : null;
    const withKey = source
      ? ({
          ...nextInstance,
          repositoryKey: sandboxGitHubSourceRepositoryKey(source.repository),
        } as SandboxProviderInstanceConfig)
      : (() => {
          const { repositoryKey: _dropKey, ...withoutKey } = nextInstance;
          return withoutKey as SandboxProviderInstanceConfig;
        })();
    onUpdate(withKey);
  };

  return (
    <div className="border-t border-border/60 first:border-t-0">
      <div className="px-4 py-3.5 sm:px-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h3 className="text-[13px] font-semibold tracking-[-0.01em] text-foreground">
                {displayName}
              </h3>
              <code className="truncate rounded bg-muted/60 px-1 py-0.5 text-[10px] text-muted-foreground">
                {instanceId}
              </code>
              <Badge variant="secondary">{instance.driver}</Badge>
              {available ? (
                <Badge variant="default">available</Badge>
              ) : reason ? (
                <Badge variant="destructive">{reason}</Badge>
              ) : null}
              {sessionStatus === "running" ? (
                <Badge variant="default" className="bg-green-600 text-green-50">
                  running
                </Badge>
              ) : sessionStatus === "stopped" ? (
                <Badge variant="secondary" className="bg-muted text-muted-foreground">
                  stopped
                </Badge>
              ) : null}
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      className="size-5 rounded-sm p-0 text-muted-foreground hover:text-destructive"
                      onClick={onDelete}
                      aria-label={`Delete sandbox environment ${instanceId}`}
                    >
                      <Trash2Icon className="size-3" />
                    </Button>
                  }
                />
                <TooltipPopup side="top">Delete sandbox environment</TooltipPopup>
              </Tooltip>
            </div>
            <p className="text-xs text-muted-foreground/80">
              {session
                ? hasSavedRecordForSession
                  ? `Session ready: ${session.httpBaseUrl} (env ${session.environmentId})`
                  : `Running at ${session.httpBaseUrl} — not paired. Retry pairing to use it in Add project.`
                : isVercel
                  ? "Provisions an ephemeral Vercel Sandbox microVM, reached over a public URL."
                  : "Provision an isolated container reached over localhost."}
            </p>
          </div>
          <div className="flex w-full shrink-0 items-center gap-2 sm:w-auto sm:justify-end">
            {sessionStatus === "running" ? (
              <>
                {!hasSavedRecordForSession ? (
                  <Button size="sm" disabled={actionsBlocked} onClick={onRetryPairing}>
                    {instanceBusy === "start" ? "Pairing…" : "Retry pairing"}
                  </Button>
                ) : null}
                <Button size="sm" variant="outline" disabled={actionsBlocked} onClick={onStop}>
                  {instanceBusy === "stop" ? "Stopping…" : "Stop"}
                </Button>
              </>
            ) : sessionStatus === "stopped" ? (
              <Button size="sm" variant="outline" disabled={actionsBlocked} onClick={onStart}>
                {instanceBusy === "start" ? "Starting…" : "Start"}
              </Button>
            ) : null}
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => onExpandedChange(!isExpanded)}
              aria-label={`Toggle ${displayName} details`}
            >
              <ChevronDownIcon
                className={cn("size-3.5 transition-transform", isExpanded && "rotate-180")}
              />
            </Button>
          </div>
        </div>
      </div>

      <Collapsible open={isExpanded} onOpenChange={onExpandedChange}>
        <CollapsibleContent>
          <div className="space-y-0">
            <div className="border-t border-border/60 px-4 py-3 sm:px-5">
              <label htmlFor={`sandbox-instance-${instanceId}-display-name`} className="block">
                <span className="text-xs font-medium text-foreground">Display name</span>
                <DraftInput
                  id={`sandbox-instance-${instanceId}-display-name`}
                  className="mt-1.5"
                  value={instance.displayName ?? ""}
                  onCommit={updateDisplayName}
                  placeholder="Instance label"
                  spellCheck={false}
                />
                <span className="mt-1 block text-xs text-muted-foreground">
                  Optional label shown in the deployment list.
                </span>
              </label>
            </div>

            {isVercel ? (
              <VercelConfigFields
                config={instance.config}
                idPrefix={`sandbox-instance-${instanceId}`}
                onChange={updateConfig}
                machineSizeLocked={sessionStatus !== undefined}
              />
            ) : (
              <DockerConfigFields
                config={instance.config}
                idPrefix={`sandbox-instance-${instanceId}`}
                onChange={updateConfig}
              />
            )}

            <div className="border-t border-border/60 px-4 py-3 sm:px-5">
              <ProviderEnvironmentSection
                environment={instance.environment ?? []}
                onChange={updateEnvironment}
                title="Runtime environment variables"
                {...(isVercel ? { prefillNames: VERCEL_REQUIRED_ENV_NAMES } : {})}
                description={
                  isVercel
                    ? "Apply to every session on this target. Add VERCEL_TOKEN, VERCEL_TEAM_ID, and VERCEL_PROJECT_ID here as sensitive variables."
                    : "Apply to every session on this target (e.g. API keys the sandbox server needs at boot)."
                }
              />
            </div>

            <div className="border-t border-border/60 px-4 py-3 sm:px-5">
              {usesGitHubSource ? (
                <div className="grid gap-4">
                  <SandboxGitHubSourcePicker
                    idPrefix={`sandbox-instance-${instanceId}`}
                    repository={githubSource?.repository}
                    branch={githubSource?.branch}
                    locked={sourceLocked}
                    onRepositoryChange={({ repository, defaultBranch }) =>
                      setSource({
                        repository,
                        ...(defaultBranch.length > 0 ? { branch: defaultBranch } : {}),
                      })
                    }
                    onBranchChange={(branch) => setSource({ branch })}
                  />
                  {githubSource && githubSourceKey ? (
                    <>
                      <p className="text-xs text-muted-foreground">
                        Kata reads <code>.kata/environment.json</code> from the selected branch when
                        creating this sandbox. Its install, start, and terminal fields override the
                        corresponding saved settings below.
                      </p>
                      <SavedEnvironmentEditor
                        projects={projects}
                        savedSandboxEnvironments={savedSandboxEnvironments}
                        selectedRepositoryKey={undefined}
                        onSelectedRepositoryKeyChange={() => {}}
                        onChange={onSavedEnvironmentChange}
                        fixedRepositoryKey={githubSourceKey}
                      />
                    </>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Choose a GitHub repository and branch to configure its setup.
                    </p>
                  )}
                </div>
              ) : (
                <SavedEnvironmentEditor
                  projects={projects}
                  savedSandboxEnvironments={savedSandboxEnvironments}
                  selectedRepositoryKey={selectedRepositoryKey}
                  onSelectedRepositoryKeyChange={onSelectedRepositoryKeyChange}
                  onChange={onSavedEnvironmentChange}
                />
              )}
            </div>

            <div className="space-y-3 border-t border-border/60 px-4 py-3 sm:px-5">
              {statusDetail ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-amber-600">{statusDetail}</span>
                </div>
              ) : null}
              {sessionStatus === "running" ? (
                <div className="flex flex-wrap items-center gap-2">
                  {session ? (
                    <span className="text-xs text-muted-foreground">
                      {session.httpBaseUrl} (env {session.environmentId})
                    </span>
                  ) : null}
                  {deadlineEpochMs !== undefined ? (
                    <span className="text-xs text-muted-foreground">
                      Expires in {formatRemaining(deadlineEpochMs)}
                    </span>
                  ) : null}
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={instanceBusy !== undefined}
                    onClick={onStop}
                  >
                    {instanceBusy === "stop" ? "Stopping…" : "Stop"}
                  </Button>
                  {supportsRenewTimeout ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={instanceBusy !== undefined}
                      onClick={onRenew}
                    >
                      {instanceBusy === "renew" ? "Extending…" : "Extend"}
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={instanceBusy !== undefined}
                    onClick={() => setSignInFor("claude")}
                  >
                    Sign in to Claude
                  </Button>
                  {!hasSavedRecordForSession ? (
                    <Button
                      size="sm"
                      disabled={instanceBusy !== undefined}
                      onClick={onRetryPairing}
                    >
                      {instanceBusy === "start" ? "Pairing…" : "Retry pairing"}
                    </Button>
                  ) : null}
                </div>
              ) : null}
              <div className="flex flex-wrap items-center gap-2">
                {sessionStatus === undefined ? (
                  <>
                    <Button size="sm" disabled={createBlocked} onClick={onStart}>
                      {listUiState === "loading"
                        ? "Loading…"
                        : instanceBusy === "start"
                          ? "Starting…"
                          : "Create & run sandbox"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={actionsBlocked || !available}
                      onClick={onTest}
                    >
                      {listUiState === "loading"
                        ? "Loading…"
                        : instanceBusy === "test"
                          ? "Testing…"
                          : "Test connection"}
                    </Button>
                  </>
                ) : sessionStatus === "stopped" ? (
                  <>
                    <Button size="sm" disabled={actionsBlocked} onClick={onStart}>
                      {instanceBusy === "start" ? "Starting…" : "Start"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-destructive/40 text-destructive hover:bg-destructive/10"
                      disabled={actionsBlocked}
                      onClick={onDispose}
                    >
                      {instanceBusy === "dispose" ? "Deleting…" : "Delete sandbox"}
                    </Button>
                  </>
                ) : null}
              </div>
              {progress.length > 0 || instanceBusy === "test" ? (
                <pre className="text-xs whitespace-pre-wrap text-muted-foreground">
                  {progress.join("\n")}
                </pre>
              ) : null}
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>
      {signInFor !== null ? (
        <ProviderSignInDialog
          instanceId={instanceId}
          providerId={signInFor}
          onClose={() => setSignInFor(null)}
        />
      ) : null}
    </div>
  );
}

/** Format the remaining lifetime from an epoch-ms deadline. */
function formatRemaining(deadlineEpochMs: number): string {
  const remaining = deadlineEpochMs - Date.now();
  if (remaining <= 0) return "soon";
  const minutes = Math.floor(remaining / 60_000);
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours}h ${mins}m`;
  }
  return `${minutes}m`;
}

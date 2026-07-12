"use client";

import { useAuth } from "@clerk/react";
import { ChevronDownIcon, Trash2Icon } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  EnvironmentId,
  SandboxProviderDriverKind,
  type ProviderInstanceEnvironmentVariable,
  type SavedSandboxEnvironmentMap,
  type SandboxInstanceSummary,
  type SandboxProviderInstanceConfig,
  type SandboxProviderInstanceConfigMap,
  type SandboxTestConnectionProgressEvent,
} from "@kata-sh/code-contracts";
import { useShallow } from "zustand/react/shallow";

import { refreshManagedRelayEnvironments } from "../../cloud/managedRelayState";
import { resolveRelayClerkTokenOptions, hasCloudPublicConfig } from "../../cloud/publicConfig";
import { useSettings, useUpdateSettings } from "../../hooks/useSettings";
import {
  addSavedEnvironment,
  getPrimaryEnvironmentConnection,
  removeSavedEnvironment,
  useSavedEnvironmentRegistryStore,
} from "../../environments/runtime";
import { cn } from "../../lib/utils";
import { useServerConfig } from "../../rpc/serverState";
import { selectProjectsAcrossEnvironments, useStore } from "../../store";
import type { Project } from "../../types";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { Collapsible, CollapsibleContent } from "../ui/collapsible";
import { DraftInput } from "../ui/draft-input";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { useHostedConnectAuthPrompt } from "../clerk/useHostedConnectAuthPrompt";
import { ProviderEnvironmentSection } from "./ProviderInstanceCard";
import { ProviderSignInDialog } from "./ProviderSignInDialog";
import { DockerConfigFields, VercelConfigFields } from "./SandboxDriverConfigFields";
import { SavedEnvironmentEditor } from "./SavedEnvironmentEditor";
import { VercelSourcePicker } from "./VercelSourcePicker";
import {
  shouldSeedRepositoryForStart,
  canCreateVercelSandbox,
  readVercelSource,
  setVercelSource,
  vercelSourceRepositoryKey,
  resolveSandboxListUiState,
  type SandboxListUiState,
} from "./SandboxDeploymentSettings.logic";
import { SettingsSection } from "./settingsLayout";

const VERCEL_KIND = SandboxProviderDriverKind.make("vercel");

/** Credentials the Vercel sandbox driver requires at session start. */
const VERCEL_REQUIRED_ENV_NAMES = ["VERCEL_TOKEN", "VERCEL_TEAM_ID", "VERCEL_PROJECT_ID"] as const;

/** Per-instance busy state for the long-running RPCs. */
type BusyOp = "test" | "start" | "dispose" | "renew" | "stop";

/** Reject a lifecycle RPC that never settles (server restart / dropped WS /
 * interrupted fiber) so the button cannot stick on "Stopping…"/"Starting…".
 * The provider work may still complete server-side; a follow-up refresh
 * reconciles the real status. */
async function withRpcTimeout<T>(
  label: string,
  run: () => Promise<T>,
  timeoutMs = 60_000,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      run(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(
            new Error(`${label} timed out. The server may still be finishing; refresh to check.`),
          );
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** Render a non-empty failure message for the progress log and toasts.
 * Effect fiber failures can surface as objects whose `message` is empty. */
function failureMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  if (typeof error === "string" && error.trim().length > 0) {
    return error;
  }
  const rendered = String(error ?? "").trim();
  return rendered.length > 0 && rendered !== "[object Object]" ? rendered : "Unknown error.";
}

/**
 * Settings panel for environment definitions. Lists configured targets with
 * their materialized status, and provides Test connection (streaming) / Start
 * session / Dispose / Delete for sandbox-backed environments. Writes go
 * through `useUpdateSettings` against the `sandboxProviderInstances` settings
 * map (no plaintext secrets in settings);
 * the live RPCs (list/test/start/dispose) go through the paired WS client.
 */
interface SandboxDeploymentSettingsProps {
  readonly headerAction?: ReactNode;
  readonly savedEnvironmentRows?: ReactNode;
  readonly hasSavedEnvironmentRows?: boolean;
}

export function SandboxDeploymentSettings({
  headerAction,
  savedEnvironmentRows,
  hasSavedEnvironmentRows = false,
}: SandboxDeploymentSettingsProps) {
  const settings = useSettings();
  const { updateSettings } = useUpdateSettings();
  const { getToken, isSignedIn } = useAuth();
  const { authPrompt, openAuthPrompt } = useHostedConnectAuthPrompt();
  const projects = useStore(useShallow(selectProjectsAcrossEnvironments));
  const serverConfig = useServerConfig();
  const serverConfigReady = serverConfig !== null;
  const instanceMap = (settings.sandboxProviderInstances ?? {}) as SandboxProviderInstanceConfigMap;
  const savedSandboxEnvironments = settings.savedSandboxEnvironments as
    | SavedSandboxEnvironmentMap
    | undefined;

  const [summaries, setSummaries] = useState<ReadonlyArray<SandboxInstanceSummary>>([]);
  const [summariesLoaded, setSummariesLoaded] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [listPending, setListPending] = useState(false);
  const listRefreshGenerationRef = useRef(0);
  const [testProgress, setTestProgress] = useState<Record<string, string[]>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [selectedRepositoryKeyByInstance, setSelectedRepositoryKeyByInstance] = useState<
    Record<string, string>
  >({});
  const [activeSession, setActiveSession] = useState<
    Record<string, { environmentId: string; httpBaseUrl: string }>
  >({});
  const [busy, setBusy] = useState<Record<string, BusyOp>>({});

  const listUiState = resolveSandboxListUiState({
    summariesLoaded,
    listError,
    listPending,
  });

  /** Mark an instance busy for `op` while `fn` runs, then clear it. Centralizes
   * the `finally { setBusy ... delete }` cleanup that every long-running
   * handler otherwise duplicates. */
  const withBusy = useCallback(
    async <T,>(instanceId: string, op: BusyOp, fn: () => Promise<T>): Promise<T> => {
      setBusy((prev) => ({ ...prev, [instanceId]: op }));
      try {
        return await fn();
      } finally {
        setBusy((prev) => {
          const next = { ...prev };
          delete next[instanceId];
          return next;
        });
      }
    },
    [],
  );

  const refreshList = useCallback(async () => {
    const generation = ++listRefreshGenerationRef.current;
    setListPending(true);
    try {
      // Bound the RPC so a hung listInstances (WS interrupt / slow Vercel status)
      // cannot leave Environments on "Loading sandbox status…" forever.
      const result = await withRpcTimeout(
        "Loading sandbox status",
        () => getPrimaryEnvironmentConnection().client.sandbox.listInstances(),
        30_000,
      );
      if (generation !== listRefreshGenerationRef.current) return;
      setSummaries(result.instances);
      setActiveSession(
        Object.fromEntries(
          result.instances.flatMap((summary) => {
            if (summary.kind !== "available" || !summary.runningSession) return [];
            return [
              [
                summary.instanceId as string,
                {
                  environmentId: summary.runningSession.environmentId,
                  httpBaseUrl: summary.runningSession.endpoint.httpBaseUrl,
                },
              ],
            ];
          }),
        ),
      );
      setSummariesLoaded(true);
      setListError(null);
    } catch (error) {
      if (generation !== listRefreshGenerationRef.current) return;
      const message = error instanceof Error ? error.message : "Unknown error.";
      // Do not clear summariesLoaded — keep a prior successful list so Start/Stop
      // stay usable after a refresh blip or timeout.
      setListError(message);
      toastManager.add({
        type: "error",
        title: "Failed to list sandbox targets",
        description: message,
      });
    } finally {
      if (generation === listRefreshGenerationRef.current) {
        setListPending(false);
      }
    }
  }, []);

  // Retry when the primary WS config snapshot arrives (first paint can race
  // auth) and whenever the configured instance map changes.
  useEffect(() => {
    if (!serverConfigReady) return;
    void refreshList();
  }, [refreshList, settings.sandboxProviderInstances, serverConfigReady]);

  const summaryById = useMemo(() => {
    const map: Record<string, SandboxInstanceSummary> = {};
    for (const summary of summaries) {
      map[summary.instanceId as string] = summary;
    }
    return map;
  }, [summaries]);

  const repositoryProjects = useMemo(
    () => projects.filter((project) => Boolean(project.repositoryIdentity?.canonicalKey)),
    [projects],
  );

  const resolveSelectedProject = useCallback(
    (instanceId: string): Project | undefined => {
      const selectedKey = selectedRepositoryKeyByInstance[instanceId];
      if (selectedKey) {
        const selectedProject = repositoryProjects.find(
          (project) => project.repositoryIdentity?.canonicalKey === selectedKey,
        );
        if (selectedProject) return selectedProject;
      }
      const instance = (instanceMap as Record<string, SandboxProviderInstanceConfig>)[instanceId];
      if (instance?.repositoryKey) {
        const persistedProject = repositoryProjects.find(
          (project) => project.repositoryIdentity?.canonicalKey === instance.repositoryKey,
        );
        if (persistedProject) return persistedProject;
      }
      return repositoryProjects[0];
    },
    [repositoryProjects, selectedRepositoryKeyByInstance, instanceMap],
  );

  const handleTest = useCallback(
    (instanceId: string) =>
      withBusy(instanceId, "test", async () => {
        setTestProgress((prev) => ({ ...prev, [instanceId]: [] }));
        try {
          let failedDetail: string | null = null;
          await getPrimaryEnvironmentConnection().client.sandbox.testConnection(
            instanceId as never,
            (event: SandboxTestConnectionProgressEvent) => {
              if (!event.ok) {
                failedDetail =
                  "detail" in event && event.detail ? event.detail : `${event.stage} failed.`;
              }
              setTestProgress((prev) => ({
                ...prev,
                [instanceId]: [
                  ...(prev[instanceId] ?? []),
                  `${event.stage}: ${event.ok ? "ok" : "failed"}${
                    "detail" in event && event.detail ? ` — ${event.detail}` : ""
                  }`,
                ],
              }));
            },
          );
          if (failedDetail) {
            throw new Error(failedDetail);
          }
          toastManager.add({
            type: "success",
            title: "Test connection complete",
            description: `Sandbox '${instanceId}' validated.`,
          });
        } catch (error) {
          toastManager.add({
            type: "error",
            title: "Test connection failed",
            description: error instanceof Error ? error.message : "Unknown error.",
          });
        }
      }),
    [withBusy],
  );

  const handleStart = useCallback(
    (instanceId: string) =>
      withBusy(instanceId, "start", async () => {
        const instance = (instanceMap as Record<string, SandboxProviderInstanceConfig>)[instanceId];
        // Vercel clones its GitHub source server-side from config; never attach
        // a local project repository for it.
        const isVercelInstance = (instance?.driver as string) === (VERCEL_KIND as string);
        const shouldSeedRepository =
          !isVercelInstance && shouldSeedRepositoryForStart(summaryById[instanceId]);
        const project = shouldSeedRepository ? resolveSelectedProject(instanceId) : undefined;
        const startedRepositoryKey = shouldSeedRepository
          ? (project?.repositoryIdentity?.canonicalKey as string | undefined)
          : undefined;
        if (hasCloudPublicConfig() && !isSignedIn) {
          openAuthPrompt();
          return;
        }
        try {
          const connectAuthToken = hasCloudPublicConfig()
            ? await getToken(resolveRelayClerkTokenOptions())
            : null;
          if (hasCloudPublicConfig() && !connectAuthToken) {
            throw new Error("Sign in to Kata Code Connect before starting a deployment session.");
          }
          const result = await withRpcTimeout("Start session", () =>
            getPrimaryEnvironmentConnection().client.sandbox.startSession({
              instanceId: instanceId as never,
              ...(connectAuthToken ? { connectAuthToken } : {}),
              ...(project?.repositoryIdentity
                ? {
                    repository: {
                      repoRoot: project.cwd,
                      repositoryIdentity: project.repositoryIdentity,
                    },
                  }
                : {}),
            }),
          );
          setActiveSession((prev) => ({
            ...prev,
            [instanceId]: {
              environmentId: result.environmentId,
              httpBaseUrl: result.endpoint.httpBaseUrl,
            },
          }));
          setTestProgress((prev) => ({
            ...prev,
            [instanceId]: [...(prev[instanceId] ?? []), "start: ok"],
          }));

          let savedForProjectPicker = false;
          try {
            await addSavedEnvironment({
              // Prefer the instance display name so Environments dedupe and
              // Available Runtimes stay aligned with the deployment-target card.
              label: instance?.displayName?.trim() || result.endpoint.label,
              host: result.endpoint.httpBaseUrl,
              pairingCode: result.pairingToken,
              sandbox: {
                providerKind: (instance?.driver as string) ?? "local",
                instanceId,
              },
            });
            savedForProjectPicker = true;
            setTestProgress((prev) => ({
              ...prev,
              [instanceId]: [...(prev[instanceId] ?? []), "connect: ok"],
            }));
          } catch (error) {
            const message = failureMessage(error);
            setTestProgress((prev) => ({
              ...prev,
              [instanceId]: [...(prev[instanceId] ?? []), `connect: failed — ${message}`],
            }));
            toastManager.add({
              type: "error",
              title: "Sandbox started but was not added",
              description: message,
            });
          }
          refreshManagedRelayEnvironments();
          await refreshList();

          if (startedRepositoryKey && instance) {
            updateInstance(instanceId, { ...instance, repositoryKey: startedRepositoryKey });
          }

          if (savedForProjectPicker) {
            toastManager.add({
              type: "success",
              title: "Sandbox session started",
              description: "Available from Add project.",
            });
          }
        } catch (error) {
          const message = failureMessage(error);
          setTestProgress((prev) => ({
            ...prev,
            [instanceId]: [...(prev[instanceId] ?? []), `start: failed — ${message}`],
          }));
          toastManager.add({
            type: "error",
            title: "Start session failed",
            description: message,
          });
          // Start-from-stopped keeps the VM on Connect failure; refresh so the
          // card shows provider truth (running/stopped) instead of a stale list.
          await refreshList();
        }
      }),
    [
      getToken,
      instanceMap,
      isSignedIn,
      openAuthPrompt,
      refreshList,
      resolveSelectedProject,
      selectedRepositoryKeyByInstance,
      summaryById,
      withBusy,
    ],
  );

  const handleDispose = useCallback(
    (instanceId: string) =>
      withBusy(instanceId, "dispose", async () => {
        try {
          const session = activeSession[instanceId];
          const connection = getPrimaryEnvironmentConnection();
          // Long cloud lifecycle calls can outlive the primary RPC heartbeat.
          // Rotate the transport before disposal so a socket that still
          // answers pings cannot leave the delete request queued forever. The
          // full environment reconnect also waits for a shell snapshot, which
          // is unrelated to this lifecycle request and can block recovery.
          await connection.client.reconnect();
          const result = await withRpcTimeout("Delete sandbox", () =>
            connection.client.sandbox.disposeSession({
              instanceId: instanceId as never,
            }),
          );
          if (!result.disposed) {
            toastManager.add({
              type: "error",
              title: "Delete sandbox failed",
              description: "No sandbox session to delete, or another operation is in progress.",
            });
            return;
          }
          if (session) {
            // The remote sandbox can disappear before its saved WebSocket
            // connection finishes closing. Do not hold the lifecycle UI open
            // on that best-effort local cleanup.
            void removeSavedEnvironment(EnvironmentId.make(session.environmentId)).catch(
              (error) => {
                toastManager.add({
                  type: "error",
                  title: "Sandbox removed but saved environment remains",
                  description: error instanceof Error ? error.message : "Unknown error.",
                });
              },
            );
          }
          setActiveSession((prev) => {
            const next = { ...prev };
            delete next[instanceId];
            return next;
          });
          refreshManagedRelayEnvironments();
          await refreshList();
          setActiveSession((prev) => {
            const next = { ...prev };
            delete next[instanceId];
            return next;
          });
          toastManager.add(
            result.connectCleanup === "pending"
              ? {
                  type: "error",
                  title: "Sandbox deleted; Connect cleanup pending",
                  description:
                    "The sandbox is gone, but its Connect record could not be removed. Retry from Available Runtimes.",
                }
              : {
                  type: "success",
                  title: "Sandbox deleted",
                  description: `Sandbox '${instanceId}' released.`,
                },
          );
        } catch (error) {
          toastManager.add({
            type: "error",
            title: "Delete sandbox failed",
            description: error instanceof Error ? error.message : "Unknown error.",
          });
        }
      }),
    [activeSession, refreshList, withBusy],
  );

  const handleStop = useCallback(
    (instanceId: string) =>
      withBusy(instanceId, "stop", async () => {
        try {
          await withRpcTimeout("Stop session", () =>
            getPrimaryEnvironmentConnection().client.sandbox.stopSession({
              instanceId: instanceId as never,
            }),
          );
          refreshManagedRelayEnvironments();
          await refreshList();
          toastManager.add({
            type: "success",
            title: "Sandbox stopped",
            description: `Sandbox '${instanceId}' stopped. Start it again to resume.`,
          });
        } catch (error) {
          toastManager.add({
            type: "error",
            title: "Stop failed",
            description: error instanceof Error ? error.message : "Unknown error.",
          });
          // A timed-out/interrupted stop may still be settling server-side.
          await refreshList();
        }
      }),
    [refreshList, withBusy],
  );

  const handleRenew = useCallback(
    (instanceId: string) =>
      withBusy(instanceId, "renew", async () => {
        try {
          await withRpcTimeout("Extend session", () =>
            getPrimaryEnvironmentConnection().client.sandbox.renewSession({
              instanceId: instanceId as never,
            }),
          );
          await refreshList();
        } catch (error) {
          toastManager.add({
            type: "error",
            title: "Extend failed",
            description: error instanceof Error ? error.message : "Unknown error.",
          });
        }
      }),
    [refreshList, withBusy],
  );

  /** Recovery path (identity plan R2): the sandbox is running but pairing
   *  failed or the saved environment is missing. Mint a fresh pairing token
   *  against the live sandbox and re-run addSavedEnvironment. */
  const handleRetryPairing = useCallback(
    (instanceId: string) =>
      withBusy(instanceId, "start", async () => {
        const instance = (instanceMap as Record<string, SandboxProviderInstanceConfig>)[instanceId];
        try {
          const issued = await withRpcTimeout("Retry pairing", () =>
            getPrimaryEnvironmentConnection().client.sandbox.issuePairingToken({
              instanceId: instanceId as never,
            }),
          );
          await addSavedEnvironment({
            label: instance?.displayName?.trim() || issued.endpoint.label,
            host: issued.endpoint.httpBaseUrl,
            pairingCode: issued.pairingToken,
            sandbox: {
              providerKind: (instance?.driver as string) ?? "local",
              instanceId,
            },
          });
          setTestProgress((prev) => ({
            ...prev,
            [instanceId]: [...(prev[instanceId] ?? []), "connect: ok (re-paired)"],
          }));
          toastManager.add({
            type: "success",
            title: "Sandbox paired",
            description: "Available from Add project.",
          });
          await refreshList();
        } catch (error) {
          const message = failureMessage(error);
          setTestProgress((prev) => ({
            ...prev,
            [instanceId]: [...(prev[instanceId] ?? []), `connect: failed — ${message}`],
          }));
          toastManager.add({
            type: "error",
            title: "Pairing failed",
            description: message,
          });
        }
      }),
    [instanceMap, refreshList, withBusy],
  );

  const handleRemove = useCallback(
    (instanceId: string) => {
      if (activeSession[instanceId]) {
        toastManager.add({
          type: "error",
          title: "Delete the sandbox first",
          description:
            "Expand this environment and click “Delete sandbox” to remove the running/stopped sandbox, then remove the environment.",
        });
        return;
      }
      const nextMap = { ...instanceMap };
      delete nextMap[instanceId as keyof typeof nextMap];
      updateSettings({ sandboxProviderInstances: nextMap });
      toastManager.add({
        type: "success",
        title: "Sandbox environment removed",
        description: `'${instanceId}' removed from Environments.`,
      });
    },
    [activeSession, instanceMap, updateSettings],
  );

  const updateInstance = useCallback(
    (instanceId: string, next: SandboxProviderInstanceConfig) => {
      updateSettings({
        sandboxProviderInstances: { ...instanceMap, [instanceId]: next },
      });
    },
    [instanceMap, updateSettings],
  );

  const instanceEntries = Object.entries(instanceMap);

  return (
    <>
      <SettingsSection title="Environments" headerAction={headerAction}>
        {listUiState === "error" ? (
          <div className="flex flex-col gap-2 border-t border-border/60 px-4 py-3 first:border-t-0 sm:flex-row sm:items-center sm:justify-between sm:px-5">
            <p className="text-xs text-destructive">
              Could not load sandbox status
              {listError ? `: ${listError}` : "."}
            </p>
            <Button
              size="sm"
              variant="outline"
              disabled={listPending}
              onClick={() => void refreshList()}
            >
              {listPending ? "Retrying…" : "Retry"}
            </Button>
          </div>
        ) : null}
        {listUiState === "loading" && instanceEntries.length > 0 ? (
          <div className="border-t border-border/60 px-4 py-3 first:border-t-0 sm:px-5">
            <p className="text-xs text-muted-foreground">Loading sandbox status…</p>
          </div>
        ) : null}
        {hasSavedEnvironmentRows ? savedEnvironmentRows : null}
        {instanceEntries.length === 0 && !hasSavedEnvironmentRows ? (
          <div className="border-t border-border/60 px-4 py-3.5 first:border-t-0 sm:px-5">
            <p className="text-xs text-muted-foreground">
              No environments configured. Add a remote link, Docker container, or cloud provider
              {typeof window !== "undefined" && window.desktopBridge ? ", or SSH host" : ""}.
            </p>
          </div>
        ) : (
          instanceEntries.map(([id, config]) => {
            const summary = summaryById[id];
            const available = listUiState === "ready" && summary?.kind === "available";
            const reason =
              listUiState === "ready" && summary?.kind === "unavailable"
                ? summary.reason
                : undefined;
            const session = activeSession[id];
            const progress = testProgress[id] ?? [];
            const instanceBusy = busy[id];
            const isOpen = expanded[id] ?? false;
            const displayName = config.displayName ?? id;
            const selectedProject = resolveSelectedProject(id);
            const selectedRepositoryKey =
              selectedRepositoryKeyByInstance[id] ??
              (config.repositoryKey as string | undefined) ??
              (selectedProject?.repositoryIdentity?.canonicalKey as string | undefined);
            return (
              <DeploymentTargetCard
                key={id}
                instanceId={id}
                instance={config}
                displayName={displayName}
                available={available}
                reason={reason}
                session={session}
                summary={listUiState === "ready" ? summary : undefined}
                listUiState={listUiState}
                progress={progress}
                instanceBusy={instanceBusy}
                isExpanded={isOpen}
                projects={projects}
                savedSandboxEnvironments={savedSandboxEnvironments}
                selectedRepositoryKey={selectedRepositoryKey}
                onExpandedChange={(open) => setExpanded((prev) => ({ ...prev, [id]: open }))}
                onUpdate={(next) => updateInstance(id, next)}
                onSavedEnvironmentChange={(next) =>
                  updateSettings({ savedSandboxEnvironments: next })
                }
                onSelectedRepositoryKeyChange={(repositoryKey) => {
                  setSelectedRepositoryKeyByInstance((prev) => ({ ...prev, [id]: repositoryKey }));
                  updateInstance(id, { ...config, repositoryKey });
                }}
                onDelete={() => handleRemove(id)}
                onTest={() => void handleTest(id)}
                onStart={() => void handleStart(id)}
                onStop={() => void handleStop(id)}
                onDispose={() => void handleDispose(id)}
                onRenew={() => void handleRenew(id)}
                onRetryPairing={() => void handleRetryPairing(id)}
              />
            );
          })
        )}
      </SettingsSection>
      {authPrompt}
    </>
  );
}

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

  // Vercel source selection (GitHub repository + branch). The source is locked
  // once a sandbox exists; creation requires a complete source.
  const vercelSource = isVercel ? readVercelSource(instance.config) : null;
  const sourceLocked = isVercel && sessionStatus !== undefined;
  const vercelSourceKey = vercelSource
    ? vercelSourceRepositoryKey(vercelSource.repository)
    : undefined;
  const createDisabledForSource = !canCreateVercelSandbox({
    isVercel,
    config: instance.config,
  });
  const actionsBlocked = listUiState !== "ready" || instanceBusy !== undefined;
  const createBlocked = actionsBlocked || !available || createDisabledForSource;

  const setSource = (next: { repository?: string; branch?: string }) => {
    const { config: _omit, ...rest } = instance;
    const nextConfig = setVercelSource(instance.config, next);
    const nextInstance =
      nextConfig !== undefined
        ? ({ ...rest, config: nextConfig } as SandboxProviderInstanceConfig)
        : (rest as SandboxProviderInstanceConfig);
    // Keep the settings envelope repositoryKey aligned with the source so saved
    // per-repo settings key consistently with the server derivation.
    const source = nextConfig ? readVercelSource(nextConfig) : null;
    const withKey = source
      ? ({
          ...nextInstance,
          repositoryKey: vercelSourceRepositoryKey(source.repository),
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
              {isVercel ? (
                <div className="grid gap-4">
                  <VercelSourcePicker
                    idPrefix={`sandbox-instance-${instanceId}`}
                    repository={vercelSource?.repository}
                    branch={vercelSource?.branch}
                    locked={sourceLocked}
                    onRepositoryChange={({ repository, defaultBranch }) =>
                      setSource({
                        repository,
                        ...(defaultBranch.length > 0 ? { branch: defaultBranch } : {}),
                      })
                    }
                    onBranchChange={(branch) => setSource({ branch })}
                  />
                  {vercelSource && vercelSourceKey ? (
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
                        fixedRepositoryKey={vercelSourceKey}
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

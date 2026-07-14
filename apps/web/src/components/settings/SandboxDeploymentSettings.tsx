"use client";

import { useAuth } from "@clerk/react";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  EnvironmentId,
  SandboxProviderDriverKind,
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
} from "../../environments/runtime";
import { useServerConfig, useServerWelcomeSubscription } from "../../rpc/serverState";
import { selectProjectsAcrossEnvironments, useStore } from "../../store";
import type { Project } from "../../types";
import { Button } from "../ui/button";
import { toastManager } from "../ui/toast";
import { useHostedConnectAuthPrompt } from "../clerk/useHostedConnectAuthPrompt";
import { DeploymentTargetCard } from "./SandboxDeploymentTargetCard";
import {
  shouldSeedRepositoryForStart,
  resolveSandboxListUiState,
} from "./SandboxDeploymentSettings.logic";
import { SettingsSection } from "./settingsLayout";

export { DeploymentTargetCard };

const VERCEL_KIND = SandboxProviderDriverKind.make("vercel");

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
  /** Fired after a successful `listInstances` so Available Runtimes can reuse
   *  the same summaries (avoids a second RPC and a stale stopped/running join). */
  readonly onInstancesChanged?: (instances: ReadonlyArray<SandboxInstanceSummary>) => void;
}

export function SandboxDeploymentSettings({
  headerAction,
  savedEnvironmentRows,
  hasSavedEnvironmentRows = false,
  onInstancesChanged,
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
  const summariesLoadedRef = useRef(false);
  summariesLoadedRef.current = summariesLoaded;
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
  // Settings come from the primary WS config snapshot. Until it arrives,
  // useSettings() falls back to DEFAULT empty sandboxProviderInstances —
  // showing "No environments configured" would flash incorrectly.
  const settingsReady = serverConfigReady;

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

  const refreshList = useCallback(
    async (options?: { readonly silent?: boolean }) => {
      const generation = ++listRefreshGenerationRef.current;
      const silent = options?.silent === true;
      if (!silent) setListPending(true);
      try {
        // Bound the RPC so a hung listInstances (WS interrupt) cannot leave
        // Environments on "Loading sandbox status…" forever. Provider status
        // reconcile runs in the background on the server and must not own this
        // deadline.
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
        onInstancesChanged?.(result.instances);
      } catch (error) {
        if (generation !== listRefreshGenerationRef.current) return;
        const message = error instanceof Error ? error.message : "Unknown error.";
        // Do not clear summariesLoaded — keep a prior successful list so Start/Stop
        // stay usable after a refresh blip or timeout.
        setListError(message);
        // Toast only on a cold failure (no prior list). Background/silent
        // refreshes and refreshes that already have cards must not spam errors.
        if (!silent && !summariesLoadedRef.current) {
          toastManager.add({
            type: "error",
            title: "Failed to list sandbox targets",
            description: message,
          });
        }
      } finally {
        if (generation === listRefreshGenerationRef.current && !silent) {
          setListPending(false);
        }
      }
    },
    [onInstancesChanged],
  );

  // Retry when the primary WS config snapshot arrives (first paint can race
  // auth) and whenever the configured instance map changes. A short silent
  // follow-up picks up background provider-status reconcile without blocking
  // first paint.
  useEffect(() => {
    if (!serverConfigReady) return;
    void refreshList();
    const followUp = window.setTimeout(() => {
      void refreshList({ silent: true });
    }, 2_500);
    return () => window.clearTimeout(followUp);
  }, [refreshList, settings.sandboxProviderInstances, serverConfigReady]);

  // Re-list on every (re)connect. A listInstances dispatched on a socket that
  // is then replaced by a reconnect now rejects (TransportSessionReplacedError)
  // instead of hanging — this welcome-driven refresh reloads against the fresh
  // session so "Loading sandbox status…" always resolves without a page reload.
  useServerWelcomeSubscription(
    useCallback(() => {
      void refreshList({ silent: true });
    }, [refreshList]),
  );

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
          // Vercel provisioning can legitimately exceed the UI's generic
          // lifecycle deadline while the provider sandbox is already running.
          // The transport rejects this request if its session is replaced, and
          // the server owns provider-stage deadlines, so await the authoritative
          // result instead of reporting a false client-side timeout.
          const result = await getPrimaryEnvironmentConnection().client.sandbox.startSession({
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
          });
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
              {!settingsReady
                ? "Loading environments…"
                : `No environments configured. Add a remote link, Docker container, or cloud provider${
                    typeof window !== "undefined" && window.desktopBridge ? ", or SSH host" : ""
                  }.`}
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

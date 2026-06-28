"use client";

import { ChevronDownIcon, PlusIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  SandboxProviderDriverKind,
  SandboxProviderInstanceId,
  type SandboxInstanceSummary,
  type SandboxProviderInstanceConfig,
  type SandboxProviderInstanceConfigMap,
  type SandboxTestConnectionProgressEvent,
} from "@kata-sh/code-contracts";

import { useSettings, useUpdateSettings } from "../../hooks/useSettings";
import { getPrimaryEnvironmentConnection } from "../../environments/runtime";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
  DialogTrigger,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Badge } from "../ui/badge";
import { Collapsible, CollapsibleContent } from "../ui/collapsible";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { SettingsSection } from "./settingsLayout";

const DOCKER_KIND = SandboxProviderDriverKind.make("docker");

/** Slugify a label into a sandbox instance id suffix (mirrors provider dialog). */
function slugifyLabel(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 48);
}

function rpcClient() {
  return getPrimaryEnvironmentConnection().client;
}

/**
 * Settings panel for sandbox deployment targets (Phase 1: local Docker
 * containers). Lists configured targets with their materialized status, and
 * provides Add / Test connection (streaming) / Start session / Dispose /
 * Remove. Writes go through `useUpdateSettings` against the
 * `sandboxProviderInstances` settings map (no plaintext secrets in settings);
 * the live RPCs (list/test/start/dispose) go through the paired WS client.
 */
export function SandboxDeploymentSettings() {
  const settings = useSettings();
  const { updateSettings } = useUpdateSettings();
  const instanceMap = (settings.sandboxProviderInstances ?? {}) as SandboxProviderInstanceConfigMap;

  const [summaries, setSummaries] = useState<ReadonlyArray<SandboxInstanceSummary>>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [testProgress, setTestProgress] = useState<Record<string, string[]>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [activeSession, setActiveSession] = useState<
    Record<string, { environmentId: string; httpBaseUrl: string }>
  >({});
  const [busy, setBusy] = useState<Record<string, "test" | "start" | "dispose">>({});

  const refreshList = useCallback(async () => {
    try {
      const result = await rpcClient().sandbox.listInstances();
      setSummaries(result.instances);
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Failed to list sandbox targets",
        description: error instanceof Error ? error.message : "Unknown error.",
      });
    }
  }, []);

  useEffect(() => {
    void refreshList();
  }, [refreshList, settings.sandboxProviderInstances]);

  const summaryById = useMemo(() => {
    const map: Record<string, SandboxInstanceSummary> = {};
    for (const summary of summaries) {
      map[summary.instanceId as string] = summary;
    }
    return map;
  }, [summaries]);

  const handleTest = useCallback(async (instanceId: string) => {
    setBusy((prev) => ({ ...prev, [instanceId]: "test" }));
    setTestProgress((prev) => ({ ...prev, [instanceId]: [] }));
    try {
      await rpcClient().sandbox.testConnection(
        instanceId as never,
        (event: SandboxTestConnectionProgressEvent) => {
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
    } finally {
      setBusy((prev) => {
        const next = { ...prev };
        delete next[instanceId];
        return next;
      });
    }
  }, []);

  const handleStart = useCallback(async (instanceId: string) => {
    setBusy((prev) => ({ ...prev, [instanceId]: "start" }));
    try {
      const result = await rpcClient().sandbox.startSession({
        instanceId: instanceId as never,
      });
      setActiveSession((prev) => ({
        ...prev,
        [instanceId]: {
          environmentId: result.environmentId,
          httpBaseUrl: result.endpoint.httpBaseUrl,
        },
      }));
      toastManager.add({
        type: "success",
        title: "Sandbox session started",
        description: `Reachable at ${result.endpoint.httpBaseUrl}.`,
      });
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Start session failed",
        description: error instanceof Error ? error.message : "Unknown error.",
      });
    } finally {
      setBusy((prev) => {
        const next = { ...prev };
        delete next[instanceId];
        return next;
      });
    }
  }, []);

  const handleDispose = useCallback(async (instanceId: string) => {
    setBusy((prev) => ({ ...prev, [instanceId]: "dispose" }));
    try {
      await rpcClient().sandbox.disposeSession({ instanceId: instanceId as never });
      setActiveSession((prev) => {
        const next = { ...prev };
        delete next[instanceId];
        return next;
      });
      toastManager.add({
        type: "success",
        title: "Sandbox disposed",
        description: `Sandbox '${instanceId}' released.`,
      });
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Dispose failed",
        description: error instanceof Error ? error.message : "Unknown error.",
      });
    } finally {
      setBusy((prev) => {
        const next = { ...prev };
        delete next[instanceId];
        return next;
      });
    }
  }, []);

  const handleRemove = useCallback(
    (instanceId: string) => {
      const nextMap = { ...instanceMap };
      delete nextMap[instanceId as keyof typeof nextMap];
      updateSettings({ sandboxProviderInstances: nextMap });
      toastManager.add({
        type: "success",
        title: "Deployment target removed",
        description: `'${instanceId}' removed from Environments.`,
      });
    },
    [instanceMap, updateSettings],
  );

  const instanceEntries = Object.entries(instanceMap);

  return (
    <SettingsSection
      title="Deployment targets"
      headerAction={
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <Tooltip>
            <TooltipTrigger
              render={
                <DialogTrigger
                  render={
                    <Button
                      size="xs"
                      variant="ghost"
                      className="h-5 gap-1 rounded-sm px-1 text-[11px] font-normal text-muted-foreground/60 hover:text-muted-foreground"
                      aria-label="Add deployment target"
                    >
                      <PlusIcon className="size-3" />
                      <span>Add deployment target</span>
                    </Button>
                  }
                />
              }
            />
            <TooltipPopup side="top">Add deployment target</TooltipPopup>
          </Tooltip>
          <AddDeploymentTargetDialogBody
            existingIds={new Set(instanceEntries.map(([id]) => id))}
            onAdd={(id, instance) => {
              updateSettings({
                sandboxProviderInstances: { ...instanceMap, [id]: instance },
              });
              setAddOpen(false);
            }}
          />
        </Dialog>
      }
    >
      {instanceEntries.length === 0 ? (
        <div className="border-t border-border/60 px-4 py-3.5 first:border-t-0 sm:px-5">
          <p className="text-xs text-muted-foreground">
            No deployment targets configured. Add one to provision a container.
          </p>
        </div>
      ) : (
        instanceEntries.map(([id, config]) => {
          const summary = summaryById[id];
          const available = summary?.kind === "available";
          const reason = summary?.kind === "unavailable" ? summary.reason : undefined;
          const session = activeSession[id];
          const progress = testProgress[id] ?? [];
          const instanceBusy = busy[id];
          const isOpen = expanded[id] ?? false;
          const displayName = config.displayName ?? id;
          return (
            <div key={id} className="border-t border-border/60 first:border-t-0">
              <div className="px-4 py-3.5 sm:px-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <h3 className="text-[13px] font-semibold tracking-[-0.01em] text-foreground">
                        {displayName}
                      </h3>
                      <Badge variant="secondary">{config.driver}</Badge>
                      {available ? (
                        <Badge variant="default">available</Badge>
                      ) : reason ? (
                        <Badge variant="destructive">{reason}</Badge>
                      ) : null}
                    </div>
                    <p className="text-xs text-muted-foreground/80">
                      {session
                        ? `Session ready: ${session.httpBaseUrl} (env ${session.environmentId})`
                        : "Provision an isolated container reached over localhost."}
                    </p>
                  </div>
                  <div className="flex w-full shrink-0 items-center gap-2 sm:w-auto sm:justify-end">
                    {session ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={instanceBusy !== undefined}
                        onClick={() => void handleDispose(id)}
                      >
                        {instanceBusy === "dispose" ? "Disposing…" : "Dispose"}
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        disabled={instanceBusy !== undefined || !available}
                        onClick={() => void handleStart(id)}
                      >
                        {instanceBusy === "start" ? "Starting…" : "Start session"}
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
                      onClick={() => setExpanded((prev) => ({ ...prev, [id]: !isOpen }))}
                      aria-label={`Toggle ${displayName} details`}
                    >
                      <ChevronDownIcon
                        className={cn("size-3.5 transition-transform", isOpen && "rotate-180")}
                      />
                    </Button>
                  </div>
                </div>
              </div>
              <Collapsible
                open={isOpen}
                onOpenChange={(open) => setExpanded((prev) => ({ ...prev, [id]: open }))}
              >
                <CollapsibleContent>
                  <div className="space-y-3 border-t border-border/60 px-4 py-3 sm:px-5">
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={instanceBusy !== undefined || !available}
                        onClick={() => void handleTest(id)}
                      >
                        {instanceBusy === "test" ? "Testing…" : "Test connection"}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-muted-foreground hover:text-foreground"
                        disabled={instanceBusy !== undefined}
                        onClick={() => handleRemove(id)}
                      >
                        Remove
                      </Button>
                    </div>
                    {progress.length > 0 || instanceBusy === "test" ? (
                      <pre className="text-xs whitespace-pre-wrap text-muted-foreground">
                        {progress.join("\n")}
                      </pre>
                    ) : null}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            </div>
          );
        })
      )}
    </SettingsSection>
  );
}

interface AddDeploymentTargetDialogBodyProps {
  existingIds: Set<string>;
  onAdd: (id: string, instance: SandboxProviderInstanceConfig) => void;
}

function AddDeploymentTargetDialogBody({ existingIds, onAdd }: AddDeploymentTargetDialogBodyProps) {
  // Defaults match the driver's DEFAULT_DOCKER_CONFIG: a node http stub that
  // responds 200 on /healthz, so Add -> Test connection works out of the box.
  // Swap image + command for a real `katacode` image once one is published.
  const [label, setLabel] = useState("");
  const [image, setImage] = useState("node:22-alpine");
  const [command, setCommand] = useState(
    "node -e \"require('http').createServer((q,s)=>{s.end('katacode-serve-stub')}).listen(13773)\"",
  );
  const [port, setPort] = useState("13773");
  const [error, setError] = useState<string | null>(null);

  const instanceId = useMemo(() => {
    const suffix = slugifyLabel(label) || "default";
    return `${DOCKER_KIND}_${suffix}`;
  }, [label]);

  const handleSubmit = useCallback(() => {
    if (existingIds.has(instanceId)) {
      setError(`Instance id '${instanceId}' already exists. Choose a different label.`);
      return;
    }
    const portNumber = Number(port);
    if (!Number.isFinite(portNumber) || portNumber <= 0) {
      setError("Container port must be a positive number.");
      return;
    }
    try {
      const brandedId = SandboxProviderInstanceId.make(instanceId);
      const instance: SandboxProviderInstanceConfig = {
        driver: DOCKER_KIND,
        enabled: true,
        ...(label.trim().length > 0 ? { displayName: label.trim() } : {}),
        config: { image, command, port: portNumber },
      };
      onAdd(brandedId as string, instance);
      setLabel("");
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Invalid instance id.");
    }
  }, [existingIds, instanceId, label, image, command, port, onAdd]);

  return (
    <DialogPopup className="max-w-xl overflow-hidden">
      <DialogHeader>
        <DialogTitle>Add container deployment target</DialogTitle>
        <DialogDescription>
          Provisions an isolated Docker container running a Kata server, reached over localhost.
        </DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-3 p-4">
        <div className="flex flex-col gap-1">
          <Label htmlFor="sandbox-label">Label</Label>
          <Input
            id="sandbox-label"
            value={label}
            placeholder="e.g. Work"
            onChange={(e) => setLabel(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">Instance id: {instanceId}</p>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="sandbox-image">Image</Label>
          <Input id="sandbox-image" value={image} onChange={(e) => setImage(e.target.value)} />
          <p className="text-xs text-muted-foreground">
            Must contain your start command's runtime. Use a <code>katacode</code> image once
            published.
          </p>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="sandbox-command">Start command</Label>
          <Input
            id="sandbox-command"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Launches the Kata server inside the container. The default is a stub that answers{" "}
            <code>/healthz</code>; use <code>katacode serve --port 13773</code> with a real{" "}
            <code>katacode</code> image.
          </p>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="sandbox-port">Container port</Label>
          <Input id="sandbox-port" value={port} onChange={(e) => setPort(e.target.value)} />
        </div>
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
      </div>
      <DialogFooter>
        <DialogClose render={<Button variant="ghost">Cancel</Button>} />
        <Button onClick={handleSubmit}>Add target</Button>
      </DialogFooter>
    </DialogPopup>
  );
}

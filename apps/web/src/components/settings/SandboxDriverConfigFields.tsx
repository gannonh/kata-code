"use client";

import {
  formatVercelVcpusLabel,
  readVercelVcpus,
  VERCEL_VCPU_OPTIONS,
} from "./SandboxDeploymentSettings.logic";
import { DraftInput } from "../ui/draft-input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";

interface DockerConfigFieldsProps {
  readonly config: unknown;
  readonly idPrefix: string;
  readonly onChange: (nextConfig: Record<string, unknown> | undefined) => void;
}

function readConfigString(config: unknown, key: string): string {
  if (config === null || typeof config !== "object") return "";
  const value = (config as Record<string, unknown>)[key];
  return typeof value === "string" ? value : "";
}

function readConfigNumber(config: unknown, key: string): string {
  if (config === null || typeof config !== "object") return "";
  const value = (config as Record<string, unknown>)[key];
  return typeof value === "number" ? String(value) : "";
}

function setConfigField(
  config: unknown,
  key: string,
  value: string,
  clearWhenEmpty: "omit" | "persist" = "omit",
): Record<string, unknown> | undefined {
  const base: Record<string, unknown> =
    config !== null && typeof config === "object" ? { ...(config as Record<string, unknown>) } : {};
  const trimmed = value.trim();
  if (clearWhenEmpty === "omit" && trimmed.length === 0) {
    delete base[key];
  } else {
    base[key] = value;
  }
  return Object.keys(base).length > 0 ? base : undefined;
}

/** Parse a container port string into a validated integer in 1..65535, or null. */
function parseContainerPort(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d+$/u.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 65_535 ? parsed : null;
}

/** Set a numeric container port field, rejecting non-integer/out-of-range values.
 * An empty input clears the field. */
function setContainerPort(
  config: unknown,
  key: string,
  value: string,
): Record<string, unknown> | undefined {
  const base: Record<string, unknown> =
    config !== null && typeof config === "object" ? { ...(config as Record<string, unknown>) } : {};
  if (value.trim().length === 0) {
    delete base[key];
  } else {
    const parsed = parseContainerPort(value);
    if (parsed === null) return base;
    base[key] = parsed;
  }
  return Object.keys(base).length > 0 ? base : undefined;
}

/**
 * Inline editor for the docker driver config (image, command, port), mirroring
 * `ProviderSettingsForm`'s card variant layout. The web app cannot import the
 * server-only `@kata-sh/code-sandbox-docker` `DockerSandboxConfig` schema, so
 * this renders the known fields directly against the opaque `config` blob.
 */
export function DockerConfigFields({ config, idPrefix, onChange }: DockerConfigFieldsProps) {
  const fields: ReadonlyArray<{
    key: string;
    label: string;
    description: string;
    placeholder: string;
    kind: "text" | "port";
  }> = [
    {
      key: "image",
      label: "Image",
      description: "Container image (must contain your start command's runtime).",
      placeholder: "katacode:local",
      kind: "text",
    },
    {
      key: "command",
      label: "Start command",
      description:
        "Command to launch the Kata server inside the container, e.g. `katacode serve --port 13773`.",
      placeholder: "katacode serve --port 13773",
      kind: "text",
    },
    {
      key: "port",
      label: "Container port",
      description: "In-container port the Kata server listens on.",
      placeholder: "13773",
      kind: "port",
    },
  ];
  return (
    <>
      {fields.map((field) => (
        <div key={field.key} className="border-t border-border/60 px-4 py-3 sm:px-5">
          <label htmlFor={`${idPrefix}-${field.key}`} className="block">
            <span className="text-xs font-medium text-foreground">{field.label}</span>
            <DraftInput
              id={`${idPrefix}-${field.key}`}
              className="mt-1.5"
              value={
                field.kind === "port"
                  ? readConfigNumber(config, field.key)
                  : readConfigString(config, field.key)
              }
              onCommit={(next) =>
                onChange(
                  field.kind === "port"
                    ? setContainerPort(config, field.key, next)
                    : setConfigField(config, field.key, next),
                )
              }
              placeholder={field.placeholder}
              spellCheck={false}
              inputMode={field.kind === "port" ? "numeric" : undefined}
            />
            <span className="mt-1 block text-xs text-muted-foreground">{field.description}</span>
          </label>
        </div>
      ))}
    </>
  );
}

interface VercelConfigFieldsProps {
  readonly config: unknown;
  readonly idPrefix: string;
  readonly onChange: (nextConfig: Record<string, unknown> | undefined) => void;
  /** True once a sandbox VM exists (running or stopped). vCPUs are create-only. */
  readonly machineSizeLocked: boolean;
}

/** Inline editor for the Vercel Sandbox driver config (runtime, persistent,
 *  timeout, port, vCPUs). Mirrors DockerConfigFields' layout. */
export function VercelConfigFields({
  config,
  idPrefix,
  onChange,
  machineSizeLocked,
}: VercelConfigFieldsProps) {
  const persistent =
    config !== null &&
    typeof config === "object" &&
    (config as Record<string, unknown>).persistent !== false;
  const timeoutMs = readConfigNumber(config, "timeoutMs");
  const timeoutMinutes = timeoutMs ? String(Math.round(Number(timeoutMs) / 60_000)) : "";
  return (
    <>
      <div className="border-t border-border/60 px-4 py-3 sm:px-5">
        <label htmlFor={`${idPrefix}-runtime`} className="block">
          <span className="text-xs font-medium text-foreground">Runtime</span>
          <DraftInput
            id={`${idPrefix}-runtime`}
            className="mt-1.5"
            value={readConfigString(config, "runtime")}
            onCommit={(next) => onChange(setConfigField(config, "runtime", next))}
            placeholder="node24"
            spellCheck={false}
          />
          <span className="mt-1 block text-xs text-muted-foreground">
            Vercel Sandbox runtime (e.g. node24).
          </span>
        </label>
      </div>
      <div className="border-t border-border/60 px-4 py-3 sm:px-5">
        <label htmlFor={`${idPrefix}-persistent`} className="block">
          <span className="text-xs font-medium text-foreground">Persistent filesystem</span>
          <div className="mt-1.5 flex items-center gap-2">
            <Switch
              id={`${idPrefix}-persistent`}
              checked={persistent}
              onCheckedChange={(checked) => {
                const base =
                  config !== null && typeof config === "object"
                    ? { ...(config as Record<string, unknown>) }
                    : {};
                base.persistent = Boolean(checked);
                onChange(base);
              }}
            />
            <span className="text-xs text-muted-foreground">
              Stop auto-saves the sandbox; start resumes it (bounded snapshot storage).
            </span>
          </div>
        </label>
      </div>
      <div className="border-t border-border/60 px-4 py-3 sm:px-5">
        <label htmlFor={`${idPrefix}-timeoutMs`} className="block">
          <span className="text-xs font-medium text-foreground">Timeout (minutes)</span>
          <DraftInput
            id={`${idPrefix}-timeoutMs`}
            className="mt-1.5"
            value={timeoutMinutes}
            onCommit={(next) => {
              const trimmed = next.trim();
              if (trimmed.length === 0) {
                onChange(setConfigField(config, "timeoutMs", ""));
                return;
              }
              const minutes = Number(trimmed);
              if (!Number.isFinite(minutes)) return;
              const base =
                config !== null && typeof config === "object"
                  ? { ...(config as Record<string, unknown>) }
                  : {};
              base.timeoutMs = Math.round(minutes * 60_000);
              onChange(base);
            }}
            placeholder="1440"
            spellCheck={false}
            inputMode="numeric"
          />
          <span className="mt-1 block text-xs text-muted-foreground">
            Sandbox auto-termination timeout. Hobby max is 45 minutes; Pro/Enterprise max is 24
            hours.
          </span>
        </label>
      </div>
      <div className="border-t border-border/60 px-4 py-3 sm:px-5">
        <label htmlFor={`${idPrefix}-port`} className="block">
          <span className="text-xs font-medium text-foreground">Sandbox port</span>
          <DraftInput
            id={`${idPrefix}-port`}
            className="mt-1.5"
            value={readConfigNumber(config, "port")}
            onCommit={(next) => onChange(setContainerPort(config, "port", next))}
            placeholder="13773"
            spellCheck={false}
            inputMode="numeric"
          />
        </label>
      </div>
      <div className="border-t border-border/60 px-4 py-3 sm:px-5">
        <div className="grid gap-1.5">
          <label className="text-xs font-medium text-foreground" htmlFor={`${idPrefix}-vcpus`}>
            Machine size (vCPU / RAM)
          </label>
          <Select
            value={String(readVercelVcpus(config))}
            disabled={machineSizeLocked}
            onValueChange={(next) => {
              if (machineSizeLocked || !next) return;
              const n = Number(next);
              if (!Number.isFinite(n)) return;
              const base =
                config !== null && typeof config === "object"
                  ? { ...(config as Record<string, unknown>) }
                  : {};
              base.vcpus = n;
              onChange(base);
            }}
          >
            <SelectTrigger id={`${idPrefix}-vcpus`} className="w-full sm:w-72">
              <SelectValue>{formatVercelVcpusLabel(readVercelVcpus(config))}</SelectValue>
            </SelectTrigger>
            <SelectPopup alignItemWithTrigger={false}>
              {VERCEL_VCPU_OPTIONS.map((vcpus) => (
                <SelectItem key={vcpus} value={String(vcpus)}>
                  {formatVercelVcpusLabel(vcpus)}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
          <span className="text-xs text-muted-foreground">
            {machineSizeLocked
              ? "Set at create time and cannot be changed for this sandbox. Delete and create a new sandbox to pick a different size."
              : "Applied when you create the sandbox. RAM is fixed at 2 GB per vCPU. Plan caps: Hobby ≤ 4, Pro ≤ 8, Enterprise ≤ 32 vCPUs."}
          </span>
        </div>
      </div>
    </>
  );
}

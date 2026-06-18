import * as Redacted from "effect/Redacted";

import { upsertEnvValues } from "./env-file.ts";

export interface RelayPublicConfig {
  readonly relayUrl: string;
  readonly mobileTracingUrl: string;
  readonly mobileTracingDataset: string;
  readonly mobileTracingToken: string;
  readonly clientTracingUrl: string;
  readonly clientTracingDataset: string;
  readonly clientTracingToken: string;
}

export const publicConfigEnvEntries = (config: RelayPublicConfig) =>
  ({
    KATACODE_RELAY_URL: config.relayUrl,
    KATACODE_MOBILE_OTLP_TRACES_URL: config.mobileTracingUrl,
    KATACODE_MOBILE_OTLP_TRACES_DATASET: config.mobileTracingDataset,
    KATACODE_MOBILE_OTLP_TRACES_TOKEN: config.mobileTracingToken,
    KATACODE_RELAY_CLIENT_OTLP_TRACES_URL: config.clientTracingUrl,
    KATACODE_RELAY_CLIENT_OTLP_TRACES_DATASET: config.clientTracingDataset,
    KATACODE_RELAY_CLIENT_OTLP_TRACES_TOKEN: config.clientTracingToken,
  }) as const;

export function reconcileRootEnvPublicConfig(contents: string, config: RelayPublicConfig): string {
  return upsertEnvValues(contents, publicConfigEnvEntries(config));
}

export function reconcileRootEnvRelayUrl(contents: string, relayUrl: string): string {
  return reconcileRootEnvPublicConfig(contents, {
    relayUrl,
    mobileTracingUrl: "",
    mobileTracingDataset: "",
    mobileTracingToken: "",
    clientTracingUrl: "",
    clientTracingDataset: "",
    clientTracingToken: "",
  })
    .split("\n")
    .filter((line) => !line.startsWith("KATACODE_MOBILE_OTLP_TRACES_"))
    .filter((line) => !line.startsWith("KATACODE_RELAY_CLIENT_OTLP_TRACES_"))
    .join("\n");
}

export function publicConfigFromOutput(output: unknown): RelayPublicConfig | null {
  if (typeof output !== "object" || output === null) {
    return null;
  }
  const value = output as Record<string, unknown>;
  const text = (name: string) => (typeof value[name] === "string" ? value[name] : undefined);
  const secret = (name: string): string | undefined => {
    const candidate = value[name];
    if (!Redacted.isRedacted(candidate)) {
      return text(name);
    }
    const redacted = Redacted.value(candidate);
    return typeof redacted === "string" ? redacted : undefined;
  };
  const relayUrl = text("url");
  const mobileTracingUrl = text("mobileTracingUrl");
  const mobileTracingDataset = text("mobileTracingDataset");
  const mobileTracingToken = secret("mobileTracingToken");
  const clientTracingUrl = text("clientTracingUrl");
  const clientTracingDataset = text("clientTracingDataset");
  const clientTracingToken = secret("clientTracingToken");
  return relayUrl &&
    mobileTracingUrl &&
    mobileTracingDataset &&
    mobileTracingToken &&
    clientTracingUrl &&
    clientTracingDataset &&
    clientTracingToken
    ? {
        relayUrl,
        mobileTracingUrl,
        mobileTracingDataset,
        mobileTracingToken,
        clientTracingUrl,
        clientTracingDataset,
        clientTracingToken,
      }
    : null;
}

export function serializeGithubOutput(entries: Readonly<Record<string, string | boolean>>): string {
  return Object.entries(entries)
    .map(([key, value]) => `${key}=${value}\n`)
    .join("");
}

export function serializeRelayClientTracingEnvironment(config: RelayPublicConfig): string {
  return serializeGithubOutput({
    KATACODE_RELAY_CLIENT_OTLP_TRACES_URL: config.clientTracingUrl,
    KATACODE_RELAY_CLIENT_OTLP_TRACES_DATASET: config.clientTracingDataset,
    KATACODE_RELAY_CLIENT_OTLP_TRACES_TOKEN: config.clientTracingToken,
  });
}

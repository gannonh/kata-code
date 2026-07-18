/**
 * Config schema for the Docker sandbox driver. Owned by the driver (the contract
 * layer keeps `config: Schema.Unknown`). Rendered in Settings via
 * `ProviderSettingsForm` using the `providerSettingsForm` annotations.
 *
 * @module config
 */
import * as Schema from "effect/Schema";

import { makeProviderSettingsSchema } from "@kata-sh/code-contracts/settings";
import { PortSchema, TrimmedNonEmptyString } from "@kata-sh/code-contracts/baseSchemas";

export const DockerSandboxConfig = makeProviderSettingsSchema({
  image: TrimmedNonEmptyString.pipe(
    Schema.annotateKey({
      title: "Image",
      description: "Container image (must contain your start command's runtime).",
      providerSettingsForm: { placeholder: "katacode:local", clearWhenEmpty: "omit" },
    }),
  ),
  command: TrimmedNonEmptyString.pipe(
    Schema.annotateKey({
      title: "Start command",
      description:
        "Command to launch the Kata server inside the container, e.g. `katacode serve --port 13773`.",
      providerSettingsForm: { placeholder: "katacode serve --port 13773", clearWhenEmpty: "omit" },
    }),
  ),
  port: PortSchema.pipe(
    Schema.annotateKey({
      title: "Container port",
      description: "In-container port the Kata server listens on.",
      providerSettingsForm: { placeholder: "13773" },
    }),
  ),
  extraEnv: Schema.optionalKey(
    Schema.Array(Schema.Struct({ name: Schema.String, value: Schema.String })),
  ),
  /** GitHub source selection owned by the Docker card picker (hidden from the
   *  generic settings form). Optional only for legacy targets; Create requires it. */
  source: Schema.optionalKey(
    Schema.Struct({
      repository: TrimmedNonEmptyString,
      branch: TrimmedNonEmptyString,
    }).pipe(Schema.annotateKey({ providerSettingsForm: { hidden: true } })),
  ),
});

export type DockerSandboxConfig = typeof DockerSandboxConfig.Type;

export const DEFAULT_DOCKER_CONFIG: DockerSandboxConfig = {
  image: "katacode:local",
  command: "katacode serve --port 13773",
  port: 13773,
};

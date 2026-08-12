import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SchemaIssue from "effect/SchemaIssue";

import { TrimmedNonEmptyString } from "./baseSchemas.ts";

/** Maximum number of server-owned variables passed to a provider session. */
export const PROVIDER_SESSION_ENVIRONMENT_MAX_VARIABLES = 32;
/** Maximum size of one provider environment value. */
export const PROVIDER_SESSION_ENVIRONMENT_MAX_VALUE_CHARS = 8_192;
/** Maximum number of PATH entries prepended to a provider session. */
export const PROVIDER_SESSION_ENVIRONMENT_MAX_PATH_ENTRIES = 16;
/** Maximum size of one PATH entry. */
export const PROVIDER_SESSION_ENVIRONMENT_MAX_PATH_CHARS = 4_096;

const ProviderSessionEnvironmentVariableName = TrimmedNonEmptyString.check(
  Schema.isMaxLength(128),
  Schema.isPattern(/^[a-zA-Z_][a-zA-Z0-9_]*$/u),
);
const ProviderSessionEnvironmentVariableValue = Schema.String.check(
  Schema.isMaxLength(PROVIDER_SESSION_ENVIRONMENT_MAX_VALUE_CHARS),
);
const ProviderSessionEnvironmentPath = TrimmedNonEmptyString.check(
  Schema.isMaxLength(PROVIDER_SESSION_ENVIRONMENT_MAX_PATH_CHARS),
);

/**
 * Generic server-owned provider environment additions. Values are process-local
 * and must never be copied into persisted provider runtime payloads or logs.
 */
export const ProviderSessionEnvironment = Schema.Struct({
  variables: Schema.Record(
    ProviderSessionEnvironmentVariableName,
    ProviderSessionEnvironmentVariableValue,
  ).check(Schema.isMaxProperties(PROVIDER_SESSION_ENVIRONMENT_MAX_VARIABLES)),
  executablePath: Schema.NullOr(ProviderSessionEnvironmentPath),
  pathPrepend: Schema.Array(ProviderSessionEnvironmentPath).check(
    Schema.isMaxLength(PROVIDER_SESSION_ENVIRONMENT_MAX_PATH_ENTRIES),
  ),
}).check(
  Schema.makeFilter(
    (environment) => {
      const pathChars = environment.pathPrepend.reduce((total, entry) => total + entry.length, 0);
      return pathChars <=
        PROVIDER_SESSION_ENVIRONMENT_MAX_PATH_ENTRIES * PROVIDER_SESSION_ENVIRONMENT_MAX_PATH_CHARS
        ? true
        : new SchemaIssue.InvalidValue(Option.some(environment.pathPrepend), {
            message: "Provider session PATH additions exceed the maximum size.",
          });
    },
    { identifier: "ProviderSessionEnvironmentPathBudget" },
  ),
);
export type ProviderSessionEnvironment = typeof ProviderSessionEnvironment.Type;

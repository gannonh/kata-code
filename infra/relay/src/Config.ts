import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Base64 from "effect/encoding/Base64";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as SchemaIssue from "effect/SchemaIssue";

export const ApnsEnvironment = Schema.Literals(["sandbox", "production"]);
export type ApnsEnvironment = typeof ApnsEnvironment.Type;

export const ManagedEndpointCleanupMode = Schema.Literals(["off", "dry-run", "enabled"]);
export type ManagedEndpointCleanupMode = typeof ManagedEndpointCleanupMode.Type;
const decodeManagedEndpointCleanupMode = Schema.decodeUnknownEffect(ManagedEndpointCleanupMode);

const RELAY_TUNNEL_CLEANUP_MODE = "RELAY_TUNNEL_CLEANUP_MODE";
/** Separate switch for tunnels whose host never registered recovery. */
const RELAY_LEGACY_TUNNEL_CLEANUP_MODE = "RELAY_LEGACY_TUNNEL_CLEANUP_MODE";

const cleanupModeConfig = (name: string) =>
  Config.String(name).pipe(
    Config.withDefault("off"),
    Config.map((value) => value.trim() || "off"),
    Config.mapEffect((value) =>
      decodeManagedEndpointCleanupMode(value).pipe(
        Effect.mapError((error) => new Config.ConfigError(error)),
      ),
    ),
  );

export const managedEndpointCleanupModeConfig = cleanupModeConfig(RELAY_TUNNEL_CLEANUP_MODE);
export const legacyManagedEndpointCleanupModeConfig = cleanupModeConfig(
  RELAY_LEGACY_TUNNEL_CLEANUP_MODE,
);

/**
 * Overrides the 7-day legacy grace period, in minutes, so the disposable
 * canary stage can exercise legacy cleanup. Ignored on the prod stage.
 */
const RELAY_LEGACY_TUNNEL_GRACE_MINUTES = "RELAY_LEGACY_TUNNEL_GRACE_MINUTES";

// A zero or negative override would be ignored at runtime, silently leaving
// the canary on the 7-day grace period, so reject it when the deploy reads it.
export const legacyTunnelGraceMinutesConfig = Config.option(
  Config.schema(
    Schema.NumberFromString.pipe(Schema.check(Schema.isInt(), Schema.isGreaterThan(0))),
    RELAY_LEGACY_TUNNEL_GRACE_MINUTES,
  ),
);

export interface LinearOAuthConfiguration {
  readonly clientId: string;
  readonly clientSecret: Redacted.Redacted<string>;
  /** Base64 of the 32-byte AES-256-GCM key that seals stored Linear token bundles. */
  readonly tokenEncryptionKey: Redacted.Redacted<string>;
}

const LINEAR_OAUTH_TOKEN_ENCRYPTION_KEY_BYTES = 32;

const isNonBlank = (value: string) => value.trim().length > 0;

const isLinearOAuthTokenEncryptionKey = (value: string) =>
  Result.match(Base64.decode(value), {
    onFailure: () => false,
    onSuccess: (bytes) => bytes.length === LINEAR_OAUTH_TOKEN_ENCRYPTION_KEY_BYTES,
  });

// The message names the variable but never the value, which is a secret.
const invalidLinearOAuthTokenEncryptionKey = () =>
  new Config.ConfigError(
    new Schema.SchemaError(
      new SchemaIssue.InvalidValue({
        message:
          "LINEAR_OAUTH_TOKEN_ENCRYPTION_KEY must be base64 of 32 random bytes when the Linear OAuth client is configured",
      }),
    ),
  );

/**
 * Linear is enabled only when the client id and secret are both set. A client
 * without a valid token encryption key fails deployment instead of silently
 * disabling Linear.
 */
export const linearOAuthConfig = Config.all({
  clientId: Config.option(Config.String("LINEAR_OAUTH_CLIENT_ID")),
  clientSecret: Config.option(Config.Redacted("LINEAR_OAUTH_CLIENT_SECRET")),
  tokenEncryptionKey: Config.option(Config.Redacted("LINEAR_OAUTH_TOKEN_ENCRYPTION_KEY")),
}).pipe(
  Config.mapEffect((input): Effect.Effect<LinearOAuthConfiguration | null, Config.ConfigError> => {
    const clientId = Option.filter(input.clientId, isNonBlank);
    const clientSecret = Option.filter(input.clientSecret, (value) =>
      isNonBlank(Redacted.value(value)),
    );
    if (Option.isNone(clientId) || Option.isNone(clientSecret)) {
      return Effect.succeed(null);
    }
    if (
      Option.isNone(input.tokenEncryptionKey) ||
      !isLinearOAuthTokenEncryptionKey(Redacted.value(input.tokenEncryptionKey.value))
    ) {
      return Effect.fail(invalidLinearOAuthTokenEncryptionKey());
    }
    return Effect.succeed({
      clientId: clientId.value,
      clientSecret: clientSecret.value,
      tokenEncryptionKey: input.tokenEncryptionKey.value,
    });
  }),
);

export interface ApnsCredentials {
  readonly teamId: string;
  readonly keyId: string;
  readonly privateKey: Redacted.Redacted<string>;
  readonly bundleId: string;
  readonly environment: ApnsEnvironment;
}

export class RelayConfiguration extends Context.Service<
  RelayConfiguration,
  {
    readonly relayIssuer: string;
    readonly apns: ApnsCredentials | null;
    readonly fcmServiceAccount?: Redacted.Redacted<string>;
    readonly clerkSecretKey: Redacted.Redacted<string>;
    readonly clerkPublishableKey: string;
    readonly clerkJwtAudience: string;
    readonly apnsDeliveryJobSigningSecret: Redacted.Redacted<string>;
    readonly cloudMintPrivateKey: Redacted.Redacted<string>;
    readonly cloudMintPublicKey: string;
    readonly managedEndpointBaseDomain: string | undefined;
    readonly managedEndpointNamespace: string | undefined;
    readonly linearOAuth: LinearOAuthConfiguration | null;
    readonly managedEndpointCleanupMode?: ManagedEndpointCleanupMode;
    readonly legacyManagedEndpointCleanupMode?: ManagedEndpointCleanupMode;
    /** Canary-only override of the legacy grace period; ignored on prod. */
    readonly legacyTunnelGraceMinutes?: number;
  }
>()("kata-code-relay/Config/RelayConfiguration") {}

export const make = (configuration: RelayConfiguration["Service"]) =>
  RelayConfiguration.of(configuration);

export const layer = (configuration: RelayConfiguration["Service"]) =>
  Layer.succeed(RelayConfiguration, make(configuration));

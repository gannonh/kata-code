export type EvidenceKind = "automated" | "manual";
export type EvidenceProfile = "portable" | "live";

export interface CommandPlan {
  readonly display: string;
  readonly executable: string;
  readonly args: ReadonlyArray<string>;
  readonly requiredPaths: ReadonlyArray<string>;
  readonly trustedPaths?: ReadonlyArray<string>;
}

export interface PreservationCheck {
  readonly id: string;
  readonly title: string;
  readonly evidenceKind: EvidenceKind;
  readonly evidenceProfile: EvidenceProfile;
  readonly ownerPaths: ReadonlyArray<string>;
  readonly specRefs: ReadonlyArray<string>;
  readonly commands: ReadonlyArray<CommandPlan>;
}

const nodeCommand = (
  display: string,
  args: ReadonlyArray<string>,
  requiredPaths: ReadonlyArray<string>,
  trustedPaths: ReadonlyArray<string> = [],
): CommandPlan => ({
  display,
  executable: process.execPath,
  args,
  requiredPaths,
  ...(trustedPaths.length === 0 ? {} : { trustedPaths }),
});

const vpTestCommand = (paths: ReadonlyArray<string>): CommandPlan => ({
  display: `vp test run ${paths.join(" ")}`,
  executable: "vp",
  args: ["test", "run", ...paths, "--reporter=dot"],
  requiredPaths: paths,
  trustedPaths: paths,
});

export const PRESERVATION_CHECKS = [
  {
    id: "product-identity-release-ownership",
    title: "Kata product identity and release ownership",
    evidenceKind: "automated",
    evidenceProfile: "portable",
    ownerPaths: [
      "FORK.md",
      "packages/shared/src/branding.ts",
      "package.json",
      ".github/workflows/release.yml",
    ],
    specRefs: ["FORK.md", "docs/product-branding.md", "docs/upstream/kat-3297-decisions.tsv"],
    commands: [
      nodeCommand(
        "node scripts/check-product-branding.mjs",
        ["scripts/check-product-branding.mjs"],
        ["scripts/check-product-branding.mjs", "docs/branding-exceptions.json"],
        ["scripts/check-product-branding.mjs"],
      ),
      nodeCommand(
        "node --test scripts/check-product-branding.node-test.mjs",
        ["--test", "scripts/check-product-branding.node-test.mjs"],
        ["scripts/check-product-branding.node-test.mjs", "scripts/check-product-branding.mjs"],
        ["scripts/check-product-branding.node-test.mjs"],
      ),
    ],
  },
  {
    id: "portable-brand-assets",
    title: "Portable Kata brand assets",
    evidenceKind: "automated",
    evidenceProfile: "portable",
    ownerPaths: ["assets", "scripts/lib/brand-assets.ts", "scripts/lib/icon-export.ts"],
    specRefs: ["docs/product-branding.md", "docs/upstream/kat-3297-decisions.tsv"],
    commands: [
      vpTestCommand(["scripts/lib/brand-assets.test.ts", "scripts/lib/icon-export.test.ts"]),
    ],
  },
  {
    id: "connect-wire-identity",
    title: "Kata Connect wire identity",
    evidenceKind: "automated",
    evidenceProfile: "portable",
    ownerPaths: [
      "packages/contracts/src/wireIdentity.ts",
      "scripts/check-connect-wire-identity.ts",
      "FORK.md",
    ],
    specRefs: ["FORK.md", "docs/internals/t3-connect.md"],
    commands: [
      nodeCommand(
        "node scripts/check-connect-wire-identity.ts",
        ["scripts/check-connect-wire-identity.ts"],
        ["scripts/check-connect-wire-identity.ts"],
        ["scripts/check-connect-wire-identity.ts"],
      ),
      vpTestCommand([
        "scripts/check-connect-wire-identity.test.ts",
        "packages/contracts/src/wireIdentity.test.ts",
      ]),
    ],
  },
  {
    id: "state-isolation",
    title: "Kata state and environment isolation",
    evidenceKind: "automated",
    evidenceProfile: "portable",
    ownerPaths: [
      "apps/desktop/src/app/DesktopStatePaths.ts",
      "apps/desktop/src/app/DesktopEnvironment.ts",
      "FORK.md",
    ],
    specRefs: ["FORK.md", "apps/desktop/src/app/DesktopStatePaths.test.ts"],
    commands: [
      vpTestCommand([
        "apps/desktop/src/app/DesktopStatePaths.test.ts",
        "apps/desktop/src/app/DesktopEnvironment.test.ts",
      ]),
    ],
  },
  {
    id: "sandbox-preview-default",
    title: "Sandbox preview default and settings registration",
    evidenceKind: "automated",
    evidenceProfile: "portable",
    ownerPaths: [
      "apps/server/src/serverSettings.ts",
      "apps/server/src/kataSandbox/sandboxFeature.ts",
      "apps/web/src/components/settings/ConnectionsSettings.sandbox.test.tsx",
      "apps/web/src/components/settings/settingsBranding.test.tsx",
    ],
    specRefs: ["docs/upstream/kat-3297-intake.md", "docs/upstream/kat-3297-verification.md"],
    commands: [
      vpTestCommand([
        "apps/server/src/serverSettings.test.ts",
        "apps/server/src/kataSandbox/sandboxFeature.test.ts",
        "apps/web/src/components/settings/ConnectionsSettings.sandbox.test.tsx",
        "apps/web/src/components/settings/settingsBranding.test.tsx",
      ]),
    ],
  },
  {
    id: "sandbox-route-driver-registration",
    title: "Sandbox route and provider driver registration",
    evidenceKind: "automated",
    evidenceProfile: "portable",
    ownerPaths: [
      "apps/server/src/kataSandbox",
      "apps/server/src/server.ts",
      "apps/server/src/provider/Layers/ProviderInstanceRegistryLive.ts",
    ],
    specRefs: ["docs/internals/kata-sandbox.md", "docs/upstream/kat-3297-decisions.tsv"],
    commands: [
      {
        ...vpTestCommand([
          "apps/server/src/kataSandbox/sandboxFeature.test.ts",
          "apps/server/src/provider/Layers/ProviderInstanceRegistryLive.test.ts",
          "apps/server/src/server.test.ts",
        ]),
        trustedPaths: [
          "apps/server/src/kataSandbox/sandboxFeature.test.ts",
          "apps/server/src/provider/Layers/ProviderInstanceRegistryLive.test.ts",
        ],
      },
    ],
  },
  {
    id: "provider-sandbox-environment-isolation",
    title: "Provider and sandbox environment isolation",
    evidenceKind: "automated",
    evidenceProfile: "portable",
    ownerPaths: ["apps/server/src/provider/ProviderInstanceEnvironment.ts"],
    specRefs: [
      "docs/upstream/kat-3297-decisions.tsv",
      "apps/server/src/provider/ProviderInstanceEnvironment.test.ts",
    ],
    commands: [vpTestCommand(["apps/server/src/provider/ProviderInstanceEnvironment.test.ts"])],
  },
  {
    id: "migration-identity",
    title: "Kata migration identity and upstream upgrade ordering",
    evidenceKind: "automated",
    evidenceProfile: "portable",
    ownerPaths: [
      "apps/server/src/persistence/Migrations.ts",
      "apps/server/src/persistence/Migrations/KataUpstreamUpgrade.test.ts",
      "apps/server/src/kataSandbox/migrations.ts",
    ],
    specRefs: ["docs/upstream/kat-3297-decisions.tsv", "docs/upstream/kat-3297-intake.md"],
    commands: [
      {
        ...vpTestCommand([
          "apps/server/src/persistence/Migrations/KataUpstreamUpgrade.test.ts",
          "apps/server/src/kataSandbox/migrations.test.ts",
        ]),
        trustedPaths: ["apps/server/src/kataSandbox/migrations.test.ts"],
      },
    ],
  },
  {
    id: "retained-process-credential-behavior",
    title: "Retained process and VCS behavior",
    evidenceKind: "automated",
    evidenceProfile: "portable",
    ownerPaths: ["apps/server/src/processRunner.ts", "apps/server/src/vcs/VcsProcess.ts"],
    specRefs: ["docs/upstream/kat-3297-intake.md", "docs/upstream/kat-3297-decisions.tsv"],
    commands: [
      vpTestCommand([
        "apps/server/src/processRunner.test.ts",
        "apps/server/src/vcs/VcsProcess.test.ts",
      ]),
    ],
  },
  {
    id: "retained-web-mobile-behavior",
    title: "Retained web and mobile Kata behaviors",
    evidenceKind: "automated",
    evidenceProfile: "portable",
    ownerPaths: [
      "apps/web/src/components/settings/settingsBranding.test.tsx",
      "apps/mobile/src/lib/mobileBranding.ts",
      "apps/mobile/src/lib/mobileBranding.test.ts",
    ],
    specRefs: ["docs/upstream/kat-3297-decisions.tsv", "docs/upstream/kat-3297-verification.md"],
    commands: [
      vpTestCommand([
        "apps/web/src/components/settings/settingsBranding.test.tsx",
        "apps/mobile/src/lib/mobileBranding.test.ts",
      ]),
    ],
  },
  {
    id: "mobile-shelf-preferences",
    title: "Mobile shelf preference identity and defaults",
    evidenceKind: "automated",
    evidenceProfile: "portable",
    ownerPaths: ["apps/mobile/src/features/threads/use-thread-list-v2-shelf-preferences.ts"],
    specRefs: ["docs/upstream/kat-3297-decisions.tsv"],
    commands: [
      vpTestCommand(["apps/mobile/src/features/threads/thread-list-v2-shelf-preferences.test.ts"]),
    ],
  },
  {
    id: "mobile-markdown-image-lifecycle",
    title: "Mobile Markdown image lifecycle and bounds",
    evidenceKind: "automated",
    evidenceProfile: "portable",
    ownerPaths: [
      "apps/mobile/src/features/threads/ThreadMarkdownImage.tsx",
      "apps/mobile/src/lib/markdownMedia.ts",
    ],
    specRefs: ["docs/upstream/kat-3297-decisions.tsv"],
    commands: [
      vpTestCommand([
        "apps/mobile/src/features/threads/markdownImageSize.test.ts",
        "apps/mobile/src/lib/markdownMedia.test.ts",
      ]),
    ],
  },
  {
    id: "mobile-pairing-redaction",
    title: "Mobile pairing credential redaction",
    evidenceKind: "automated",
    evidenceProfile: "portable",
    ownerPaths: ["apps/mobile/src/features/connection/pairing.ts"],
    specRefs: ["docs/upstream/kat-3297-decisions.tsv"],
    commands: [vpTestCommand(["apps/mobile/src/features/connection/pairing.test.ts"])],
  },
  {
    id: "desktop-clerk-environment-identity",
    title: "Desktop Clerk and environment identity",
    evidenceKind: "automated",
    evidenceProfile: "portable",
    ownerPaths: [
      "apps/desktop/src/app/DesktopClerk.ts",
      "apps/desktop/src/app/DesktopEnvironment.ts",
    ],
    specRefs: ["docs/upstream/kat-3297-decisions.tsv"],
    commands: [
      vpTestCommand([
        "apps/desktop/src/app/DesktopClerk.test.ts",
        "apps/desktop/src/app/DesktopEnvironment.test.ts",
      ]),
    ],
  },
  {
    id: "desktop-protocol-bundle-identity",
    title: "Desktop protocol and bundle identity",
    evidenceKind: "automated",
    evidenceProfile: "portable",
    ownerPaths: [
      "apps/desktop/src/app/DesktopAppIdentity.ts",
      "apps/desktop/src/app/DesktopEarlyElectronStartup.ts",
      "apps/desktop/src/electron/ElectronProtocol.ts",
    ],
    specRefs: ["FORK.md", "docs/upstream/kat-3297-decisions.tsv"],
    commands: [
      vpTestCommand([
        "apps/desktop/src/app/DesktopAppIdentity.test.ts",
        "apps/desktop/src/app/DesktopEarlyElectronStartup.test.ts",
        "apps/desktop/src/electron/ElectronProtocol.test.ts",
      ]),
    ],
  },
  {
    id: "desktop-url-handler-backend-routes",
    title: "Desktop URL handler and backend environment routes",
    evidenceKind: "automated",
    evidenceProfile: "portable",
    ownerPaths: [
      "apps/desktop/src/app/DesktopLinuxUrlHandler.ts",
      "apps/desktop/src/backend/DesktopBackendManager.ts",
    ],
    specRefs: ["FORK.md", "docs/upstream/kat-3297-decisions.tsv"],
    commands: [
      vpTestCommand([
        "apps/desktop/src/app/DesktopLinuxUrlHandler.test.ts",
        "apps/desktop/src/backend/DesktopBackendManager.test.ts",
      ]),
    ],
  },
  {
    id: "desktop-browser-session-isolation",
    title: "Desktop browser session namespace isolation",
    evidenceKind: "automated",
    evidenceProfile: "portable",
    ownerPaths: ["apps/desktop/src/preview/BrowserSession.ts"],
    specRefs: ["docs/upstream/kat-3297-decisions.tsv"],
    commands: [vpTestCommand(["apps/desktop/src/preview/BrowserSession.test.ts"])],
  },
  {
    id: "desktop-update-recovery",
    title: "Desktop update recovery and reservation behavior",
    evidenceKind: "automated",
    evidenceProfile: "portable",
    ownerPaths: ["apps/desktop/src/updates/DesktopUpdates.ts"],
    specRefs: ["docs/upstream/kat-3297-decisions.tsv"],
    commands: [vpTestCommand(["apps/desktop/src/updates/DesktopUpdates.test.ts"])],
  },
  {
    id: "desktop-window-behavior",
    title: "Desktop window lifecycle and reveal behavior",
    evidenceKind: "automated",
    evidenceProfile: "portable",
    ownerPaths: [
      "apps/desktop/src/window/DesktopWindow.ts",
      "apps/desktop/src/app/DesktopLifecycle.ts",
    ],
    specRefs: ["docs/upstream/kat-3297-decisions.tsv"],
    commands: [
      vpTestCommand([
        "apps/desktop/src/window/DesktopWindow.test.ts",
        "apps/desktop/src/app/DesktopLifecycle.test.ts",
      ]),
    ],
  },
  {
    id: "desktop-packaging-asset-identity",
    title: "Desktop packaging, signing, and retained asset identity",
    evidenceKind: "automated",
    evidenceProfile: "portable",
    ownerPaths: ["scripts/build-desktop-artifact.ts"],
    specRefs: ["docs/upstream/kat-3297-decisions.tsv", "docs/product-branding.md"],
    commands: [vpTestCommand(["scripts/build-desktop-artifact.test.ts"])],
  },
  {
    id: "release-package-ownership",
    title: "Kata release package and asset ownership",
    evidenceKind: "automated",
    evidenceProfile: "portable",
    ownerPaths: [
      "package.json",
      "scripts/release-asset-names.ts",
      "scripts/update-release-package-versions.ts",
      ".github/workflows/release.yml",
    ],
    specRefs: ["FORK.md", "docs/upstream/kat-3297-decisions.tsv"],
    commands: [
      vpTestCommand([
        "scripts/release-asset-names.test.ts",
        "scripts/update-release-package-versions.test.ts",
      ]),
    ],
  },
  {
    id: "desktop-launcher-identity",
    title: "Desktop launcher identity and development environment",
    evidenceKind: "automated",
    evidenceProfile: "portable",
    ownerPaths: ["apps/desktop/scripts/electron-launcher.mjs"],
    specRefs: ["docs/upstream/kat-3297-decisions.tsv"],
    commands: [vpTestCommand(["apps/desktop/scripts/electron-launcher.test.mjs"])],
  },
  {
    id: "desktop-assets-identity",
    title: "Desktop Kata asset resolution",
    evidenceKind: "automated",
    evidenceProfile: "portable",
    ownerPaths: ["apps/desktop/src/app/DesktopAssets.ts"],
    specRefs: ["docs/upstream/kat-3297-decisions.tsv", "docs/product-branding.md"],
    commands: [vpTestCommand(["apps/desktop/src/app/DesktopAssets.test.ts"])],
  },
  {
    id: "desktop-linux-keyring-behavior",
    title: "Desktop Linux keyring wording and behavior",
    evidenceKind: "automated",
    evidenceProfile: "portable",
    ownerPaths: ["apps/desktop/src/linuxSecretStorage.ts"],
    specRefs: ["docs/upstream/kat-3297-decisions.tsv"],
    commands: [vpTestCommand(["apps/desktop/src/linuxSecretStorage.test.ts"])],
  },
  {
    id: "mobile-android-asset-config-identity",
    title: "Mobile Android asset and config identity",
    evidenceKind: "automated",
    evidenceProfile: "portable",
    ownerPaths: ["apps/mobile/app.config.ts"],
    specRefs: ["docs/upstream/kat-3297-decisions.tsv", "docs/product-branding.md"],
    commands: [
      nodeCommand(
        "node scripts/check-product-branding.mjs",
        ["scripts/check-product-branding.mjs"],
        ["scripts/check-product-branding.mjs", "apps/mobile/app.config.ts"],
        ["scripts/check-product-branding.mjs"],
      ),
    ],
  },
  {
    id: "mobile-android-asset-live-evidence",
    title: "Mobile Android asset artwork evidence",
    evidenceKind: "manual",
    evidenceProfile: "live",
    ownerPaths: [
      "apps/mobile/assets/android-icon-mark.png",
      "apps/mobile/assets/android-notification-icon.png",
    ],
    specRefs: ["docs/upstream/kat-3297-decisions.tsv", "docs/product-branding.md"],
    commands: [],
  },
  {
    id: "mobile-android-fab-inset",
    title: "Mobile Android FAB and measured inset behavior",
    evidenceKind: "automated",
    evidenceProfile: "portable",
    ownerPaths: ["apps/mobile/src/features/home/android-home-fab-layout.ts"],
    specRefs: ["docs/upstream/kat-3297-decisions.tsv"],
    commands: [vpTestCommand(["apps/mobile/src/features/home/android-home-fab-layout.test.ts"])],
  },
  {
    id: "mobile-project-clone-url",
    title: "Mobile project clone URL behavior",
    evidenceKind: "automated",
    evidenceProfile: "portable",
    ownerPaths: ["apps/mobile/src/lib/projectThreadStartTurn.ts"],
    specRefs: ["docs/upstream/kat-3297-decisions.tsv"],
    commands: [vpTestCommand(["apps/mobile/src/lib/projectThreadStartTurn.test.ts"])],
  },
  {
    id: "mobile-agent-awareness-teardown",
    title: "Mobile remote agent-awareness teardown",
    evidenceKind: "automated",
    evidenceProfile: "portable",
    ownerPaths: ["apps/mobile/src/features/agent-awareness/remoteRegistration.ts"],
    specRefs: ["docs/upstream/kat-3297-decisions.tsv"],
    commands: [
      vpTestCommand(["apps/mobile/src/features/agent-awareness/remoteRegistration.test.ts"]),
    ],
  },
  {
    id: "mobile-theme-native-identity",
    title: "Mobile theme and native identity",
    evidenceKind: "automated",
    evidenceProfile: "portable",
    ownerPaths: [
      "apps/mobile/src/lib/mobileTheme.ts",
      "apps/mobile/src/lib/materialYouTheme.ts",
      "apps/mobile/src/lib/mobileThemeVariables.ts",
    ],
    specRefs: ["docs/upstream/kat-3297-decisions.tsv"],
    commands: [
      vpTestCommand([
        "apps/mobile/src/lib/mobileTheme.test.ts",
        "apps/mobile/src/lib/materialYouTheme.test.ts",
        "apps/mobile/src/lib/mobileThemeVariables.test.ts",
      ]),
    ],
  },
  {
    id: "icon-composer-live-evidence",
    title: "macOS Icon Composer output",
    evidenceKind: "manual",
    evidenceProfile: "live",
    ownerPaths: ["assets", "scripts/export-brand-icons.ts"],
    specRefs: ["docs/product-branding.md", "docs/upstream/kat-3307-runbook.md"],
    commands: [],
  },
  {
    id: "human-device-provider-evidence",
    title: "Human review of device and provider behavior",
    evidenceKind: "manual",
    evidenceProfile: "live",
    ownerPaths: ["docs/upstream/kat-3297-verification.md", ".agents/skills/verify-katacode"],
    specRefs: ["docs/upstream/kat-3297-verification.md", "docs/upstream/kat-3307-runbook.md"],
    commands: [],
  },
] as const satisfies ReadonlyArray<PreservationCheck>;

export const CANONICAL_CHECK_IDS = PRESERVATION_CHECKS.map((check) => check.id);

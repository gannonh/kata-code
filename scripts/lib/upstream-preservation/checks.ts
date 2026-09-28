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

const CONTRACT_CHECKS = [
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
    id: "provider-sandbox-environment-isolation",
    title: "Provider environment isolation",
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
    ],
    specRefs: ["docs/upstream/kat-3297-decisions.tsv", "docs/upstream/kat-3297-intake.md"],
    commands: [
      {
        ...vpTestCommand(["apps/server/src/persistence/Migrations/KataUpstreamUpgrade.test.ts"]),
        requiredPaths: [
          "apps/server/src/persistence/Migrations.ts",
          "apps/server/src/persistence/Migrations/KataUpstreamUpgrade.test.ts",
        ],
        trustedPaths: [],
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
      "scripts/release-asset-names.test.ts",
      "scripts/update-release-package-versions.ts",
      ".github/workflows/release.yml",
    ],
    specRefs: ["FORK.md", "docs/upstream/kat-3297-decisions.tsv"],
    commands: [
      {
        ...vpTestCommand([
          "scripts/release-asset-names.test.ts",
          "scripts/update-release-package-versions.test.ts",
        ]),
        requiredPaths: [
          "scripts/release-asset-names.test.ts",
          "scripts/update-release-package-versions.test.ts",
        ],
        trustedPaths: ["scripts/update-release-package-versions.test.ts"],
      },
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
    id: "connect-early-access-waitlist",
    title: "Kata Code Connect early-access waitlist",
    evidenceKind: "automated",
    evidenceProfile: "portable",
    ownerPaths: [
      "apps/web/src/components/clerk/earlyAccess.ts",
      "apps/web/src/components/clerk/useT3ConnectAuthPrompt.tsx",
      "apps/web/src/components/clerk/T3ConnectSidebarSignIn.tsx",
      "apps/web/src/components/clerk/BrowserManagedAuthShell.tsx",
      "apps/web/src/components/clerk/ElectronManagedAuthShell.tsx",
      "apps/web/src/components/onboarding/WelcomeWizard.tsx",
      "apps/mobile/src/features/cloud/cloudWaitlistJoin.ts",
      "apps/mobile/src/features/cloud/CloudWaitlistEnrollment.tsx",
      "apps/mobile/src/features/settings/SettingsWaitlistRouteScreen.tsx",
      "apps/mobile/src/features/settings/SettingsRouteScreen.tsx",
      "apps/mobile/src/features/settings/SettingsNotificationsRouteScreen.tsx",
      "apps/mobile/src/Stack.tsx",
    ],
    specRefs: ["docs/operations/connect-setup.md"],
    commands: [
      vpTestCommand([
        "apps/web/src/components/clerk/earlyAccess.test.tsx",
        "apps/mobile/src/features/cloud/cloudWaitlistJoin.test.ts",
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

export interface Retirement {
  readonly issue: string;
  readonly reason: string;
}

export interface RetirementTables {
  // A retired check does not run, and the inventory may still list it.
  readonly checks: ReadonlyMap<string, Retirement>;
  // A retired path leaves every check's owner, required, and trusted paths and its arguments.
  readonly paths: ReadonlyMap<string, Retirement>;
  // An unfrozen trusted path is still required and run, but its bytes may change.
  readonly unfrozenTrustedPaths: ReadonlyMap<string, Retirement>;
}

// CI runs the base checker, so a retirement lands here first and the code and inventory
// entries it covers are deleted in a later PR. See docs/upstream/kat-3307-runbook.md.
// KAT-3543 retired the sandbox checks; KAT-3544 removed them with the sandbox feature.
// A parked platform's checks stay retired, with code and inventory kept, until the platform
// returns. See docs/operations/supported-platforms.md.
const ANDROID_PARKED: Retirement = {
  issue: "KAT-3515",
  reason: "Android is parked; intake takes upstream Android-only changes without Kata review.",
};

export const RETIREMENTS: RetirementTables = {
  checks: new Map([
    ["mobile-android-asset-live-evidence", ANDROID_PARKED],
    ["mobile-android-fab-inset", ANDROID_PARKED],
  ]),
  paths: new Map([
    ["apps/mobile/src/lib/materialYouTheme.ts", ANDROID_PARKED],
    ["apps/mobile/src/lib/materialYouTheme.test.ts", ANDROID_PARKED],
  ]),
  unfrozenTrustedPaths: new Map(),
};

// CI runs the base checker against the candidate inventory, so a new check lands here first:
// it runs from the PR that adds it, and the inventory may omit it until a later PR adds its
// entry and removes it from this table. See docs/upstream/kat-3307-runbook.md.
export const PENDING_INVENTORY_CHECKS: ReadonlyMap<string, Retirement> = new Map([
  [
    "connect-early-access-waitlist",
    {
      issue: "KAT-3512",
      reason: "Kata keeps the Connect early-access waitlist that upstream removed at GA.",
    },
  ],
]);

export const PRESERVATION_CONTRACT: ReadonlyArray<PreservationCheck> = CONTRACT_CHECKS;

const commandPathArgs = (command: CommandPlan): ReadonlyArray<string> =>
  command.args.filter(
    (arg) => command.requiredPaths.includes(arg) || (command.trustedPaths ?? []).includes(arg),
  );

// Validates the tables against the contract and returns the checks that still run.
export function applyRetirements(
  contract: ReadonlyArray<PreservationCheck>,
  tables: RetirementTables,
): ReadonlyArray<PreservationCheck> {
  const keep = (paths: ReadonlyArray<string>) => paths.filter((path) => !tables.paths.has(path));
  const contractPaths = new Set(
    contract.flatMap((check) => [
      ...check.ownerPaths,
      ...check.commands.flatMap((command) => [
        ...command.requiredPaths,
        ...(command.trustedPaths ?? []),
      ]),
    ]),
  );
  for (const id of tables.checks.keys()) {
    if (!contract.some((check) => check.id === id))
      throw new Error(`Retired check ${id} is not in the preservation contract.`);
  }
  for (const path of tables.paths.keys()) {
    if (!contractPaths.has(path))
      throw new Error(`Retired path ${path} is not in the preservation contract.`);
  }
  const active = contract.filter((check) => !tables.checks.has(check.id));
  for (const path of tables.unfrozenTrustedPaths.keys()) {
    const trusted = active.some((check) =>
      check.commands.some((command) => keep(command.trustedPaths ?? []).includes(path)),
    );
    if (!trusted) throw new Error(`Unfrozen path ${path} is not an active trusted path.`);
  }
  return active.map((check) => {
    if (keep(check.ownerPaths).length === 0)
      throw new Error(`Retired paths leave check ${check.id} without owner paths.`);
    return {
      ...check,
      ownerPaths: keep(check.ownerPaths),
      commands: check.commands.map((command) => {
        if (command.requiredPaths.length > 0 && keep(command.requiredPaths).length === 0)
          throw new Error(
            `Retired paths leave check ${check.id} with a command that has no required paths.`,
          );
        if (commandPathArgs(command).length > 0 && keep(commandPathArgs(command)).length === 0)
          throw new Error(
            `Retired paths leave check ${check.id} with a command that has no path arguments.`,
          );
        const trustedPaths = keep(command.trustedPaths ?? []).filter(
          (path) => !tables.unfrozenTrustedPaths.has(path),
        );
        return {
          ...command,
          display: command.display
            .split(" ")
            .filter((part) => !tables.paths.has(part))
            .join(" "),
          args: keep(command.args),
          requiredPaths: keep(command.requiredPaths),
          ...(command.trustedPaths === undefined ? {} : { trustedPaths }),
        };
      }),
    };
  });
}

export const withoutRetiredPaths = (paths: ReadonlyArray<string>): ReadonlyArray<string> =>
  paths.filter((path) => !RETIREMENTS.paths.has(path));

export const RETIRED_CHECKS = RETIREMENTS.checks;

export const PRESERVATION_CHECKS = applyRetirements(CONTRACT_CHECKS, RETIREMENTS);

for (const id of PENDING_INVENTORY_CHECKS.keys()) {
  if (!PRESERVATION_CHECKS.some((check) => check.id === id))
    throw new Error(`Pending inventory check ${id} is not an active preservation check.`);
}

export const CANONICAL_CHECK_IDS = PRESERVATION_CHECKS.map((check) => check.id);

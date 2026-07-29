/** Playwright grep tags for local E2E filtering. */
export const E2E_TAGS = {
  smoke: "@smoke",
  auth: "@auth",
  settings: "@settings",
  agent: "@agent",
  pi: "@pi",
  piUpdate: "@pi-update",
  cursor: "@cursor",
  sandbox: "@sandbox",
  environmentsDeploy: "@environments-deploy",
  sidebar: "@sidebar",
  taskWorkspaces: "@task-workspaces",
} as const;

export type E2ETag = (typeof E2E_TAGS)[keyof typeof E2E_TAGS];

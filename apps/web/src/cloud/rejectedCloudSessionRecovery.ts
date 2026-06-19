export const rejectedCloudSessionMessage =
  "Your Kata Code Connect session expired. Sign in again to refresh it.";

export async function recoverRejectedCloudSession(input: {
  readonly clearCloudAuthToken?: () => Promise<void>;
  readonly signOut: () => Promise<unknown>;
  readonly openAuthPrompt: () => void;
  readonly warn?: (message: string, cause: unknown) => void;
}): Promise<void> {
  try {
    await input.clearCloudAuthToken?.();
  } catch (cause) {
    input.warn?.("Could not clear stale desktop cloud auth token.", cause);
  }
  await input.signOut();
  input.openAuthPrompt();
}

import type { EnvironmentId } from "@kata-sh/code-contracts";
import { fetchSandboxList, mintSandboxHandoff } from "./api";

export async function openCreatedSandbox(
  deploymentId: string,
  options: {
    readonly signal: AbortSignal;
    readonly isRegistered: (environmentId: EnvironmentId) => boolean;
    readonly connectPairing: (input: { readonly pairingUrl: string }) => Promise<EnvironmentId>;
    readonly openProject: (
      environmentId: EnvironmentId,
      title: string,
      signal: AbortSignal,
    ) => Promise<void>;
  },
): Promise<void> {
  options.signal.throwIfAborted();
  const listed = await fetchSandboxList(options.signal);
  options.signal.throwIfAborted();
  const summary = listed.deployments.find(
    ({ deployment }) =>
      deployment.state !== "Deleted" && deployment.intent.deploymentId === deploymentId,
  );
  if (summary?.deployment.state !== "Identified")
    throw new Error("The sandbox is not ready to open.");
  const deployment = summary.deployment;
  let environmentId = deployment.environmentId;
  if (!options.isRegistered(environmentId)) {
    const handoff = await mintSandboxHandoff(deploymentId);
    options.signal.throwIfAborted();
    environmentId = await options.connectPairing({ pairingUrl: handoff.pairingUrl });
    options.signal.throwIfAborted();
  }
  await options.openProject(
    environmentId,
    deployment.intent.source.repository.split("/").at(-1) ?? deployment.intent.label,
    options.signal,
  );
  options.signal.throwIfAborted();
}

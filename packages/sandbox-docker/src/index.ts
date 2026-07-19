/**
 * @kata-sh/code-sandbox-docker — the local Docker/OrbStack container driver.
 *
 * Implements the frozen `SandboxProvider` SPI over the raw Docker Engine HTTP
 * API (no `dockerode`). Registered with `SandboxProviderRegistry` by the server
 * layer.
 */
export {
  DockerSandboxProvider,
  dockerConfigDecoder,
  DOCKER_KIND,
  DOCKER_WORKSPACE,
  type DockerSandboxHandleState,
} from "./DockerSandboxProvider.ts";
export { DockerSandboxConfig, DEFAULT_DOCKER_CONFIG } from "./config.ts";
export {
  dockerRequest,
  dockerRequestBuffer,
  DockerEngineError,
  resolveDockerSocket,
} from "./dockerEngine.ts";
export type { DockerResponse, DockerBufferResponse } from "./dockerEngine.ts";

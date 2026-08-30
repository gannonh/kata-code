import * as Data from "effect/Data";

import type { EnvironmentId } from "@kata-sh/code-contracts";
import type {
  AllocatedDeployment,
  DockerResourceHandle,
  DeletedDeployment,
  IdentifiedDeployment,
  RequestedDeployment,
  SandboxDeployment,
  SandboxDeploymentIntent,
  SandboxEndpoint,
} from "@kata-sh/code-kata-sandbox-contracts/domain";

export type SandboxDeploymentCommand =
  | {
      readonly kind: "request";
      readonly intent: SandboxDeploymentIntent;
      readonly expectedRevision: 0;
    }
  | {
      readonly kind: "allocate";
      readonly resource: DockerResourceHandle;
      readonly expectedRevision: number;
      readonly at: string;
    }
  | {
      readonly kind: "identify";
      readonly environmentId: EnvironmentId;
      readonly endpoint: SandboxEndpoint;
      readonly resource: DockerResourceHandle;
      readonly expectedRevision: number;
      readonly at: string;
    }
  | {
      readonly kind: "delete";
      readonly expectedRevision: number;
      readonly at: string;
    };

export type SandboxDeploymentEvent =
  | {
      readonly kind: "Requested";
      readonly intent: SandboxDeploymentIntent;
    }
  | {
      readonly kind: "Allocated";
      readonly resource: DockerResourceHandle;
    }
  | {
      readonly kind: "Identified";
      readonly environmentId: EnvironmentId;
      readonly endpoint: SandboxEndpoint;
      readonly resource: DockerResourceHandle;
      readonly identifiedAt: string;
    }
  | {
      readonly kind: "Deleted";
      readonly deletedAt: string;
    };

export type SandboxDeploymentTransitionCode =
  | "missing-deployment"
  | "invalid-transition"
  | "stale-revision"
  | "conflicting-retry";

export class SandboxDeploymentTransitionError extends Data.TaggedError(
  "SandboxDeploymentTransitionError",
)<{
  readonly code: SandboxDeploymentTransitionCode;
  readonly message: string;
}> {}

function fail(
  code: SandboxDeploymentTransitionCode,
  message: string,
): SandboxDeploymentTransitionError {
  return new SandboxDeploymentTransitionError({ code, message });
}

function assertExpectedRevision(
  state: SandboxDeployment | undefined,
  expectedRevision: number,
): void {
  const actualRevision = state?.revision ?? 0;
  if (actualRevision !== expectedRevision) {
    throw fail(
      "stale-revision",
      `Expected deployment revision ${expectedRevision}, found ${actualRevision}.`,
    );
  }
}

function sameResource(left: DockerResourceHandle, right: DockerResourceHandle): boolean {
  return (
    left.containerId === right.containerId &&
    left.containerName === right.containerName &&
    left.hostPort === right.hostPort &&
    left.containerPort === right.containerPort &&
    left.ownership.controlEnvironmentId === right.ownership.controlEnvironmentId &&
    left.ownership.deploymentId === right.ownership.deploymentId &&
    left.ownership.profileId === right.ownership.profileId &&
    left.ownership.profileRevision === right.ownership.profileRevision &&
    left.ownership.schemaVersion === right.ownership.schemaVersion
  );
}

function sameIdentifiedFacts(
  state: IdentifiedDeployment,
  event: Pick<
    Extract<SandboxDeploymentCommand, { readonly kind: "identify" }>,
    "environmentId" | "endpoint" | "resource"
  >,
): boolean {
  return (
    state.environmentId === event.environmentId &&
    state.endpoint === event.endpoint &&
    sameResource(state.resource, event.resource)
  );
}

export function decide(
  state: SandboxDeployment | undefined,
  command: SandboxDeploymentCommand,
): ReadonlyArray<SandboxDeploymentEvent> {
  assertExpectedRevision(state, command.expectedRevision);

  switch (command.kind) {
    case "request":
      if (state !== undefined) {
        throw fail("invalid-transition", "A deployment can only be requested once.");
      }
      return [{ kind: "Requested", intent: command.intent }];
    case "allocate":
      if (state?.state === "Requested") {
        return [{ kind: "Allocated", resource: command.resource }];
      }
      if (state?.state === "Allocated" && sameResource(state.resource, command.resource)) {
        return [];
      }
      throw fail("invalid-transition", "Only a requested deployment can be allocated.");
    case "identify":
      if (state?.state === "Allocated") {
        return [
          {
            kind: "Identified",
            environmentId: command.environmentId,
            endpoint: command.endpoint,
            resource: command.resource,
            identifiedAt: command.at,
          },
        ];
      }
      if (state?.state === "Identified" && sameIdentifiedFacts(state, command)) {
        return [];
      }
      throw fail("invalid-transition", "Only an allocated deployment can be identified.");
    case "delete":
      if (state?.state === "Deleted") return [];
      if (state === undefined) {
        throw fail("missing-deployment", "The deployment does not exist.");
      }
      return [{ kind: "Deleted", deletedAt: command.at }];
  }
}

export function project(
  state: SandboxDeployment | undefined,
  event: SandboxDeploymentEvent,
  revision: number,
): SandboxDeployment {
  switch (event.kind) {
    case "Requested":
      if (state !== undefined) {
        throw fail("invalid-transition", "A deployment can only be requested once.");
      }
      return { state: "Requested", revision, intent: event.intent };
    case "Allocated":
      if (state?.state !== "Requested") {
        throw fail("invalid-transition", "An allocation requires a requested deployment.");
      }
      return {
        state: "Allocated",
        revision,
        intent: state.intent,
        resource: event.resource,
      };
    case "Identified":
      if (state?.state !== "Allocated") {
        throw fail("invalid-transition", "Identification requires an allocated deployment.");
      }
      return {
        state: "Identified",
        revision,
        intent: state.intent,
        resource: event.resource,
        environmentId: event.environmentId,
        endpoint: event.endpoint,
        workspaceRoot: state.intent.workspaceRoot,
        kataHome: state.intent.kataHome,
        identifiedAt: event.identifiedAt,
      };
    case "Deleted":
      if (state === undefined) {
        throw fail("missing-deployment", "The deployment does not exist.");
      }
      const deploymentId =
        state.state === "Deleted" ? state.deploymentId : state.intent.deploymentId;
      const profileId = state.state === "Deleted" ? state.profileId : state.intent.profileId;
      return {
        state: "Deleted",
        revision,
        deploymentId,
        profileId,
        ...(state.state === "Identified" ? { environmentId: state.environmentId } : {}),
        deletedAt: event.deletedAt,
      };
  }
}

export function requestDeployment(intent: SandboxDeploymentIntent): RequestedDeployment {
  return project(undefined, { kind: "Requested", intent }, 1) as RequestedDeployment;
}

export function allocateDeployment(
  state: SandboxDeployment,
  resource: DockerResourceHandle,
  at: string,
): AllocatedDeployment {
  const events = decide(state, {
    kind: "allocate",
    resource,
    expectedRevision: state.revision,
    at,
  });
  if (events.length === 0) return state as AllocatedDeployment;
  const [event] = events;
  if (event === undefined) throw new Error("Expected an allocation event.");
  return project(state, event, state.revision + 1) as AllocatedDeployment;
}

export function identifyDeployment(
  state: AllocatedDeployment,
  environmentId: EnvironmentId,
  endpoint: SandboxEndpoint,
  resource: DockerResourceHandle,
  identifiedAt: string,
): IdentifiedDeployment {
  const events = decide(state, {
    kind: "identify",
    environmentId,
    endpoint,
    resource,
    expectedRevision: state.revision,
    at: identifiedAt,
  });
  if (events.length === 0) return state as unknown as IdentifiedDeployment;
  const [event] = events;
  if (event === undefined) throw new Error("Expected an identification event.");
  return project(state, event, state.revision + 1) as IdentifiedDeployment;
}

export function deleteDeployment(state: SandboxDeployment, deletedAt: string): DeletedDeployment {
  const events = decide(state, { kind: "delete", expectedRevision: state.revision, at: deletedAt });
  if (events.length === 0) return state as DeletedDeployment;
  const [event] = events;
  if (event === undefined) throw new Error("Expected a deletion event.");
  return project(state, event, state.revision + 1) as DeletedDeployment;
}

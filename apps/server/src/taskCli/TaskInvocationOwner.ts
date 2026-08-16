import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * Durable singleton runtime fence for Task CLI credentials. The lease-owner
 * row is the single claim point: whichever process builds this layer replaces
 * the previous process's generation, and every consumer that requires this
 * service (invocation leases, check finalizers) is guaranteed to observe the
 * newly claimed generation — construction order is a Layer dependency, never
 * a startup race.
 */
export interface TaskInvocationOwnerShape {
  /** The generation this process claimed in `task_invocation_lease_owner`. */
  readonly ownerGeneration: string;
}

export class TaskInvocationOwner extends Context.Service<
  TaskInvocationOwner,
  TaskInvocationOwnerShape
>()("@kata-sh/code-cli/taskCli/TaskInvocationOwner") {}

const make = Effect.gen(function* () {
  const crypto = yield* Crypto.Crypto;
  const sql = yield* SqlClient.SqlClient;
  const ownerGeneration = yield* crypto.randomUUIDv4.pipe(Effect.orDie);
  const claimedAt = DateTime.formatIso(yield* DateTime.now);
  yield* sql`
    INSERT INTO task_invocation_lease_owner (owner_id, owner_generation, claimed_at)
    VALUES (1, ${ownerGeneration}, ${claimedAt})
    ON CONFLICT(owner_id) DO UPDATE SET
      owner_generation = excluded.owner_generation,
      claimed_at = excluded.claimed_at
  `;
  return { ownerGeneration } satisfies TaskInvocationOwnerShape;
});

export const TaskInvocationOwnerLive = Layer.effect(TaskInvocationOwner, make);

# Routine webhook callbacks

GitHub event routines receive provider deliveries at
`POST /api/routines/webhooks/github/<connectionId>`. The route is a narrow,
signature-authenticated boundary in
[`RoutineWebhooks.ts`](../../apps/server/src/routines/RoutineWebhooks.ts). It
is registered as a plain router route outside every `HttpApiBuilder` group, so
the environment session middleware never applies to it, and it never accepts a
client bearer token or environment session as authenticity.

## Authenticity and admission

Every request is checked in this order: connection exists, delivery headers
present, connection not disabled, body within the 256 KiB cap,
`X-Hub-Signature-256` matches an HMAC over the raw bytes with the connection's
secret from `ServerSecretStore`, body parses as JSON, and the payload's
`repository.id` equals the connection's stored repository id. Failures answer
4xx and increment the connection's rejected count; the body is never logged.

An accepted request is summarized by
[`GitHubRoutineEvents.ts`](../../apps/server/src/routines/GitHubRoutineEvents.ts)
and handed to `RoutineStore.admitEvent`, which runs one SQLite transaction:
delivery-id and content-digest dedupe, filter matching against enabled routines
with `trigger_kind='github'`, run insertion through the same path scheduled
routines use (including the active-slot short circuit), the delivery row, and
the connection counters. Signed pings use the same repository validation,
durable receipt, and deduplication path; they verify the connection without
creating a run. The 2xx is sent only after that commit. Digest rows older than
seven days are pruned before replay checks within the admission transaction. A failed SQLite
write answers 503 so the operator can redeliver from GitHub.

## Startup readiness

`commandReadinessLayer` in `server.ts` parks every request until the runtime is
ready, except paths under `/api/routines/webhooks/`. GitHub does not retry a
failed delivery on its own, so the callback records deliveries during startup;
it only touches SQLite and the secret store. Execution never happens in the
handler: after commit the handler offers a wake to `RoutineScheduler`, whose
existing dispatch loop drains claimable runs with the lease-holding owner.

## Scheduler isolation

Migration `055_RoutineConnections` adds `routines.trigger_kind` with default
`schedule`. Event routines keep a sentinel `next_due_at` far in the future and
the due query filters on `trigger_kind='schedule'`, so the scheduler never
selects an event routine.

## Connections

[`RoutineConnections.ts`](../../apps/server/src/routines/RoutineConnections.ts)
creates and manages hooks through `gh api`. The secret is generated locally,
stored in `ServerSecretStore` as `routine-connection-<id>`, and passed to GitHub
only on the create and rotate calls' stdin. The callback base URL is the managed
tunnel origin the relay returned at link time, persisted as the
`cloud-managed-endpoint-url` secret. Disabling removes the local secret first,
then deletes the hook on GitHub as a best effort.

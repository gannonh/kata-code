# Keep production relay Postgres on single-node PS-5

Production deploys reconcile `RelayPostgresDatabase` to the size in
`infra/relay/src/db.ts`. A larger size or a replica count above 0 in that file
scales `katacoderelay` up on the next prod deploy and raises the PlanetScale bill.
The database name is `katacoderelay`. The PlanetScale id is `s5mpblbu2m4s`.
`relay_migrations` bookkeeping stays on that database.

## Target

`infra/relay/src/db.ts` sets the prod shared database to:

- `clusterSize: "PS_5"`
- `replicas: 0`
- `arch: "arm"`
- `region: { slug: "us-west" }`

`clusterSize` already resizes in place through PlanetScale branch change requests. Unpatched
Alchemy `2.0.0-beta.76` treats a `replicas` change as a database replace. This repository patches
that package so a replica change uses the same change-request API `PostgresBranch` already uses.

Do not change `region` or `arch`. Those still replace the database. Omitting
`replicas` leaves the live replica count unchanged. Set `replicas: 0` to drop HA.

## Dry-run

From the repository root, with production deploy credentials:

```sh
vp run --filter kata-code-relay deploy --stage prod --dry-run --yes
```

You can also dispatch `.github/workflows/deploy-relay.yml` with `dry_run` set to true.

The plan must list `RelayPostgresDatabase` as `update` or `noop`. Stop if the plan lists
`replace`. Stop if deploy prints `RelayPostgresDatabase replace census`.

If Alchemy state is stuck mid-replace from an older apply:

```sh
vp run --filter kata-code-relay deploy --stage prod --abort-postgres-replace
vp run --filter kata-code-relay deploy --stage prod --inspect-postgres-state
```

Confirm the restored identity is `katacoderelay` / `s5mpblbu2m4s`. Then dry-run again.

## Apply

Production apply is a separate authorized step. Do not apply from a size-change PR unless that issue
says to apply.

After an authorized apply, inspect state again. Desired `clusterSize` must be `PS_5` and
`replicas` must be `0`. The physical database id must stay `s5mpblbu2m4s`.

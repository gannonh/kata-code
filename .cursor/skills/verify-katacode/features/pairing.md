# Pair with this environment

Pairing lets a browser become a client of this Kata Code server by consuming a one-time URL, then lands on the app instead of the pairing form.

## Sub-features

- `pair-url` consumes the startup `/pair#token=...` link on first navigation.
- `pair-form` submits a pasted token when the fragment was not present.
- `pair-refresh` recovers from a consumed or expired token without restarting the server.
- `pair-land` reaches the empty-home landing after a successful pair.

## How to get to it (user POV)

- Open the `Pairing URL:` printed when the server starts.
- Open `/pair` with no fragment and paste into `Pairing token`, then choose `Continue`.
- Run `node apps/server/src/bin.ts pair --base-dir <homeDir>` and open the new `Pairing URL:`.

## Driving it with agent-browser

Preconditions:

- `bin/doctor` reports the disposable home and `WEB_ORIGIN`.
- The browser session `katacode-verify` has not opened this pairing URL yet.

- **First navigation.** Open the launch pairing URL once. Run `agent-browser --session katacode-verify open "$PAIRING_URL"`. The heading `Pairing with this environment` may flash. Do not screenshot this URL.
- **Landed.** Wait until pairing finishes. Run `agent-browser --session katacode-verify snapshot`. The page heading is `What should we work on?` and a button `Add project` is present. The address no longer contains `#token=`.
- **Form fallback.** If the heading is `Pair with this environment`, the fragment was dropped. Fill `Pairing token` with the token from the URL hash and choose `Continue`. Do not reuse a token that already returned an error.
- **Consumed token.** If pairing failed, mint a replacement. Run `node apps/server/src/bin.ts pair --base-dir "$HOME_DIR"` from the repo root. Open that new URL once in the same session. The previous URL must not be retried.
- **Proof.** After the empty landing is visible, run `agent-browser --session katacode-verify screenshot` to `uat-evidence/<RUN_ID>/screenshots/pair-land.png` and save a snapshot to `snapshots/pair-land.aria.txt`. Both show `What should we work on?` and `Add project`. Neither file contains `token=`.

## Gotchas

- The startup pairing URL is single-use. A reachability check against the bare origin is fine. Opening the full pairing URL in a second browser is not.
- `bin/launch` disables `--browser` for this reason. Do not add it.
- Tokens from `pair` are standard scope. Settings → Connections needs the startup admin URL. Say so if you skipped that page.
- Pairing against `app.kata.sh` is a hosted-cloud path. This map covers the local web origin only.
- Doctor does not prove pairing. An unauthenticated tab on the right origin is still unusable.

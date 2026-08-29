# Pair with this environment

Pairing lets a browser become a client of this Kata Code server by consuming a one-time URL, then lands on the app instead of the pairing form.

## Sub-features

- `pair-url` consumes the startup `/pair#token=...` link on first navigation.
- `pair-form` submits a pasted token when the fragment was not present.
- `pair-refresh` recovers from a consumed or expired token without restarting the server.
- `pair-land` reaches the empty-home landing after a successful pair.

## How to get to it (user POV)

- Open the startup pairing URL. Dev-runner logs it as `pairingUrl:`. `katacode pair` / `node apps/server/src/bin.ts pair` print `Pairing URL:`.
- Open `/pair` with no fragment and paste into `Pairing token`, then choose `Continue`.
- Run `node apps/server/src/bin.ts pair --base-dir <homeDir>` and open the new `Pairing URL:`.

## Driving it with agent-browser

Preconditions:

- `bin/doctor` reports the disposable home and `WEB_ORIGIN`.
- The browser session `katacode-verify` has not opened this pairing URL yet.

- **Token-free before.** Open `$WEB_ORIGIN/` once with no pairing fragment. Run `agent-browser --session katacode-verify open "$WEB_ORIGIN/"`. The app redirects to `/pair`. Save `screenshots/pair-before.png` and `snapshots/pair-before.aria.txt`. Expect the pairing form heading `Pair with this environment` (or the empty landing only if this session is already paired). Neither file may contain `token=`. Do not open or screenshot `$PAIRING_URL` for evidence.
- **First navigation.** Open the launch pairing URL once, rewriting its host to match `$WEB_ORIGIN` when they differ (`localhost` vs `[::1]`). Run `agent-browser --session katacode-verify open "$PAIRING_URL"`. The heading `Pairing with this environment` may flash. Do not screenshot this URL or copy it into evidence.
- **Landed.** Wait until pairing finishes. Run `agent-browser --session katacode-verify snapshot`. The page heading is `What should we work on?` and a button `Add project` is present. The address no longer contains `#token=`.
- **Form fallback.** If the heading is still `Pair with this environment`, hash auto-submit did not run. That is expected when the token-free before-shot already mounted `/pair`: `peekPairingTokenFromUrl` is captured in a ref on first mount, and a later hash change does not remount. Fill `Pairing token` and choose `Continue`. Do not reuse a token that already returned an error. A reload after opening the pairing URL also remounts and auto-submits.
- **Consumed token.** If pairing failed, mint a replacement. Run `node apps/server/src/bin.ts pair --base-dir "$HOME_DIR"` from the repo root. Open that new URL once in the same session. The previous URL must not be retried.
- **Proof.** After the empty landing is visible, save `screenshots/pair-land.png` and `snapshots/pair-land.aria.txt`. Keep the token-free before artifacts. Both after files show `What should we work on?` and `Add project`. No evidence file contains `token=` or a pairing URL. Exception: never capture the pairing URL itself as before/after media; the `$WEB_ORIGIN/` pre-pair shot is the required before evidence.

## Gotchas

- The startup pairing URL is single-use. A reachability check against the bare origin is fine. Opening the full pairing URL in a second browser is not.
- Vite may bind IPv6-only. Drive `$WEB_ORIGIN` (`http://[::1]:<webPort>` on this host). A printed `http://localhost:<webPort>/pair#token=...` can hang on IPv4. Rewrite the host to match `$WEB_ORIGIN` before `open`.
- `bin/launch` disables `--browser` for this reason. Do not add it.
- Tokens from `pair` are standard scope. Settings → Connections needs the startup admin URL. Say so if you skipped that page.
- Pairing against `app.kata.sh` is a hosted-cloud path. This map covers the local web origin only.
- Doctor does not prove pairing. An unauthenticated tab on the right origin is still unusable.

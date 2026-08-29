# Usage

Usage shows estimated API cost and token counts for the connected environment, with window and metric toggles, including an honest empty state when nothing has run.

## Sub-features

- `usage-open` opens the page from the sidebar and from `/usage`.
- `usage-empty` shows zero totals on a fresh home.
- `usage-metric` switches Cost and Tokens.
- `usage-period` switches Past 24h, 7 days, 30 days, and 90 days.
- `usage-breakdown` switches Model and Day (or Hour in Past 24h).
- `usage-refresh` reloads the current window from the refresh control.

## How to get to it (user POV)

- Choose the sidebar button named `Usage`.
- Open `/usage` after pairing.
- From the usage page, choose `Back` in the sidebar to return to chat.

## Driving it with agent-browser

Preconditions:

- Pairing has succeeded. Projects are optional.
- `bin/doctor` still passes.
- Viewport is wide enough that the sidebar footer shows icon buttons (not the mobile drawer). If the `Usage` button is missing, open `/usage` and record that the sidebar entry was not reached.

- **Sidebar entry.** Choose `Usage`. Run `agent-browser --session katacode-verify click` on the button named `Usage`. The heading is `Usage`. A group named `Usage metric` contains `Cost` and `Tokens`. A group named `Usage period` contains `Past 24h`, `7 days`, `30 days`, `90 days`. `30 days` is pressed.
- **Route entry.** Open `/usage` on the same origin. Run `agent-browser --session katacode-verify open "$WEB_ORIGIN/usage"`. The same heading and groups appear. This must not require pairing again.
- **Wait for totals.** The page shows a skeleton until the environment answers. The skeleton also includes a heading `Totals`, so that heading is not a loaded signal. Wait until the hero shows `$0.00` or another `$` amount, and the breakdown shows `No activity in this window.` or a model row.
- **Empty window.** If this machine has no provider usage transcripts, the large figure is `$0.00`, the cost caption is `0 sessions · API estimate`, and the breakdown table says `No activity in this window.` If Codex or Claude Code CLIs on this host have usage, the page shows those totals even on a disposable Kata home. That is expected. Non-zero numbers are not proof that you attached to `~/.katacode`.
- **Tokens metric.** Choose `Tokens`. Run click on `Tokens` inside `Usage metric`. The large figure is a token count (for example `876M` or `0`), not a `$` amount. The chart heading contains `processed tokens`.
- **Cost metric.** Choose `Cost`. The large figure is a `$` amount. The chart heading contains `cost`.
- **Past 24h.** Choose `Past 24h`. The chart heading starts with `Hourly`. The breakdown group offers `Hour` instead of `Day`.
- **30 days.** Choose `30 days`. The chart heading starts with `Daily`. Breakdown offers `Day`.
- **Refresh.** Choose the button named `Refresh usage`. Totals remain. The heading `Usage` does not disappear.
- **Back.** Choose `Back` in the sidebar. The usage heading is gone. The empty landing or a thread is visible again.
- **Proof.** Save `uat-evidence/<RUN_ID>/screenshots/usage-cost.png` on Cost / 30 days with the heading `Usage` and either `$0.00` / `No activity in this window.` or a non-zero cost and a model row. Save `screenshots/usage-tokens.png` after choosing Tokens, where the hero figure is not a `$` amount. Save `snapshots/usage.aria.txt` from the Cost / 30 days state. `evidence.json` records both entry points or names the one that was skipped.

## Gotchas

- Isolated Kata homes still read provider usage from this machine's CLI transcripts. Zeros mean those sources are empty, not that `--home-dir` worked. Doctor's home-dir check is what proves isolation.
- Usage reads every connected environment. This launch has one. Multi-device copy (`could not report usage`, device checkmarks) will not appear. Do not skip the page because that strip is missing.
- Narrow viewports (below the `lg` / 1024px breakpoint) replace the segmented `Usage metric` / `Usage period` groups with compact selects that still use those aria-labels. Set the viewport to at least 1400×900.
- The sidebar `Usage` control is an icon button. Click by accessible name, not by guessing the chart icon.
- Settling can take a couple of seconds. Assert `Totals` and either `No activity in this window.` or a model row, not a fixed sleep alone.

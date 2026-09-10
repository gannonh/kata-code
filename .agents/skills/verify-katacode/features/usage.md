# Usage

Usage shows estimated API cost and token counts for the connected environment, with window and metric toggles (Cost, Tokens, Limits), an environment menu, and an honest empty state when nothing has run.

## Sub-features

- `usage-open` opens the page from the sidebar and from `/usage`.
- `usage-empty` shows zero totals on a fresh home.
- `usage-metric` switches Cost, Tokens, and Limits.
- `usage-period` switches Past 24h, 7 days, 30 days, and 90 days (disabled on Limits).
- `usage-breakdown` switches Model and Day (or Hour in Past 24h).
- `usage-refresh` reloads the current window from the refresh control.
- `usage-environments` opens the breadcrumb environment menu (`All environments`).
- `usage-limits` shows the Limits empty copy or host-reported pools, without claiming reset credits unless `Use reset` is on screen.

## How to get to it (user POV)

- Choose the sidebar button named `Usage`.
- Open `/usage` after pairing.
- From the usage page, choose `Back` in the sidebar to return to chat.

## Driving it with agent-browser

Preconditions:

- Pairing has succeeded and the welcome wizard is finished. Projects are optional.
- `bin/doctor` still passes.
- Viewport is wide enough that the sidebar footer shows icon buttons (not the mobile drawer). If the `Usage` button is missing, open `/usage` and record that the sidebar entry was not reached.

- **Sidebar entry.** Choose `Usage`. Run `agent-browser --session katacode-verify click` on the button named `Usage`. The heading is `Usage`. Breadcrumb named `Usage breadcrumb` includes a menu named `All environments`. A group named `Usage metric` contains `Cost`, `Tokens`, and `Limits`. A group named `Usage period` contains `Past 24h`, `7 days`, `30 days`, `90 days`. `30 days` is pressed on a fresh session.
- **Route entry.** Open `/usage` on the same origin. Run `agent-browser --session katacode-verify open "$WEB_ORIGIN/usage"` and wait on the heading `Usage`; `wait --text "Refresh usage"` never resolves because that name is an `aria-label` on an icon button. The same heading and groups appear. This must not require pairing again.
- **Environment menu.** Choose `All environments`. The menu lists checkbox `All environments`, this environment's label, and `Model prices`. Close without writing prices. Coverage notice strings (`could not report usage`, `runs an older server version`, `Counted once across environments sharing a transcript directory:`) are findings if they appear. Do not treat a missing device checkmark strip as a fail. The menu replaced that strip.
- **Wait for totals.** The page shows a skeleton until the environment answers. The skeleton also includes the headings `Totals` and `Breakdown`, so neither is a loaded signal. Wait until the hero shows `$0.00` or another `$` amount, and the breakdown shows `No activity in this window.` or a model row. If the page opened on Limits from a reused session, choose `Cost` first.
- **Empty window.** If this machine has no provider usage transcripts, the large figure is `$0.00`, the cost caption is `0 sessions · API estimate`, and the breakdown table says `No activity in this window.` If Codex or Claude Code CLIs on this host have usage, the page shows those totals even on a disposable Kata home. That is expected. Non-zero numbers are not proof that you attached to `~/.katacode`.
- **Tokens metric.** Choose `Tokens`. Run click on `Tokens` inside `Usage metric`. The large figure is a token count (for example `876M` or `0`), not a `$` amount, and its caption is `N sessions` without the `· API estimate` suffix. The chart heading (an `h2`) contains `processed tokens`; the `Totals` label `Processed tokens` exists in the skeleton too, so match the heading, not page text.
- **Cost metric.** Choose `Cost`. The large figure is a `$` amount. The chart heading contains `cost`.
- **Past 24h.** Choose `Past 24h`. The chart heading starts with `Hourly`. The breakdown group offers `Hour` instead of `Day`.
- **Breakdown.** Choose `Hour` in `Usage breakdown`. The table headers are `Hour`, one column per provider, `Total`, `Tokens`. Choose `Model`. The headers are `Model`, `Cost`, `Share`, `Tokens`.
- **30 days.** Choose `30 days`. The chart heading starts with `Daily`. Breakdown offers `Day`.
- **Refresh.** Choose the button named `Refresh usage`. Totals remain. The heading `Usage` does not disappear.
- **Limits.** Choose `Limits` inside `Usage metric`. The period group stays visible but is disabled. The refresh button is named `Refresh limits`. Wait for `No provider on the selected environments reports subscription limits.` If pool cards with `% left` appear, screenshot them and record that host providers reported limits. Do not click `Use reset` unless it is on screen and that is the feature under test. Isolated stacks usually have the empty sentence. Choose `Refresh limits`. The heading `Usage` remains. Choose `Cost` before taking Cost proof screenshots.
- **Back.** Choose `Back` in the sidebar. The usage heading is gone. The empty landing or a thread is visible again.
- **Proof.** Save `uat-evidence/<RUN_ID>/screenshots/usage-cost.png` on Cost / 30 days with the heading `Usage` and either `$0.00` / `No activity in this window.` or a non-zero cost and a model row. Save `screenshots/usage-tokens.png` after choosing Tokens, where the hero figure is not a `$` amount. Save `screenshots/usage-limits.png` on Limits with the empty-limits sentence or pool cards. Save `snapshots/usage.aria.txt` from the Cost / 30 days state. `evidence.json` records both entry points or names the one that was skipped, plus Limits and the environment menu.

## Gotchas

- Isolated Kata homes still read provider usage from this machine's CLI transcripts. Zeros mean those sources are empty, not that `--home-dir` worked. Doctor's home-dir check is what proves isolation.
- Usage reads every connected environment. This launch has one. The breadcrumb menu still says `All environments`. `<label> could not report usage.`, `runs an older server version and is excluded from totals.`, and `Counted once across environments sharing a transcript directory:` are coverage notices inside that menu. Any of them on the isolated stack is a finding, not multi-device chrome.
- Narrow viewports (below the `xl` / 1280px breakpoint) replace the segmented `Usage metric` / `Usage period` groups with compact selects that still use those aria-labels. Run `agent-browser --session katacode-verify set viewport 1400 900` after the first `open`.
- The sidebar `Usage` control is an icon button. Click by accessible name, not by guessing the chart icon.
- Settling can take a couple of seconds. Assert the hero `$` figure and either `No activity in this window.` or a model row, not `Totals` and not a fixed sleep.
- On Limits, `find role button --name "Refresh usage"` misses. Use `Refresh limits`. Do not claim pooled bars, pace, or `Use reset` unless those controls are actually on screen.

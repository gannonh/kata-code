# Settings

Settings is the preference UI for this environment. `/settings` redirects to General. Search and the section list both reach the same pages.

## Sub-features

- `settings-open` opens settings from the sidebar, the command palette, and `/settings`.
- `settings-general` shows the General section, including project grouping.
- `settings-search` filters the section list from `Search settings`.
- `settings-appearance` opens Appearance from the nav and from a search hit.
- `settings-back` returns to chat with `Back` or Escape.

## How to get to it (user POV)

- Choose the sidebar button named `Settings`.
- Press `mod+k` and choose `Open settings`.
- Open `/settings` or `/settings/general` after pairing.

## Driving it with agent-browser

Preconditions:

- Pairing has succeeded.
- `bin/doctor` still passes.
- You do not need admin pairing scopes for General or Appearance.

- **Sidebar entry.** Choose `Settings`. Run click on the button named `Settings`. The breadcrumb named `Settings breadcrumb` reads `Settings` then `General`. A heading or section title `General` is visible. A control named `Project grouping` is present.
- **Route entry.** Open `$WEB_ORIGIN/settings`. The location becomes `/settings/general` and the same General section is visible.
- **Palette entry.** Return to `/`, press `mod+k`, and choose `Open settings`. The General page opens again.
- **Search.** Focus the searchbox named `Search settings` and type `Color scheme`. Run fill on `Search settings` with `Color scheme`. A result titled `Color scheme` with subtitle `Appearance` appears. Choose it. The breadcrumb current item is `Appearance`. A section titled `Appearance` is visible.
- **Nav.** Choose `General` in the settings sidebar. The breadcrumb returns to `General`. Choose `Appearance`. The breadcrumb returns to `Appearance`.
- **Empty search.** Type `zzzxq` in `Search settings`. Status `No settings found` appears. Choose `Clear settings search`. The full section list returns.
- **Back.** Choose `Back`. Settings is gone. Chat landing or a thread is visible. Opening settings again and pressing Escape also leaves settings when search is empty. If `Search settings` has text, Escape clears the query first and stays on settings.
- **Search box.** The accessible name is `Search settings`. The visible placeholder is `Search`.
- **Proof.** Save `screenshots/settings-general.png` with the General breadcrumb and `Project grouping` visible, `screenshots/settings-appearance.png` after the Color scheme search, and `snapshots/settings-general.aria.txt`. `evidence.json` lists which of the three entry points you actually used.

## Gotchas

- `/settings` redirects to `/settings/general`. Assert General, not a page whose heading is only `Settings`.
- Connections management needs the startup admin pairing URL. A token from `node apps/server/src/bin.ts pair` is not enough for that section. Skip Connections or relaunch rather than calling it verified.
- Diagnostics is a route (`/settings/diagnostics`) that is not in the main nav labels. Do not treat it as missing Settings.
- Restore defaults lives on General only. Do not click it during a verification run unless that is the feature under test; it writes settings on this server.
- Settings search uses `/` as a hint when the box is empty. Typing `/` into a focused composer is a different shortcut. Focus `Search settings` first.

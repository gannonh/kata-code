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
- **Search.** Focus the combobox named `Search settings` (it exposes `role=combobox`, not `searchbox`) and type `Color scheme`. Run fill on `Search settings` with `Color scheme`. A result titled `Color scheme` with subtitle `Appearance` appears. Choose it. The breadcrumb current item is `Appearance`. A section titled `Appearance` is visible.
- **Nav.** Choose `General` in the settings sidebar. The breadcrumb returns to `General`. Choose `Appearance`. The breadcrumb returns to `Appearance`. The nav lists exactly `General`, `Appearance`, `Keybindings`, `Providers`, `Integrations`, `Source Control`, `Connections`, `Archive`; `Archive` routes to `/settings/archived`.
- **Empty search.** Type `zzzxq` in `Search settings`. Status `No settings found` appears. Choose `Clear settings search`. The full section list returns.
- **Back.** Choose `Back`. Settings is gone. Chat landing or a thread is visible. Opening settings again and pressing Escape also leaves settings when search is empty. If `Search settings` has text and focus is in that box, Escape clears the query and stays on settings; with focus anywhere else Escape leaves settings even with a query.
- **Search box.** The accessible name is `Search settings` and the role is `combobox`. The visible placeholder is `Search`.
- **Proof.** Save `screenshots/settings-general.png` with the General breadcrumb and `Project grouping` visible, `screenshots/settings-appearance.png` after the Color scheme search, and `snapshots/settings-general.aria.txt`. `evidence.json` lists which of the three entry points you actually used.

## Gotchas

- `/settings` redirects to `/settings/general`. Assert General, not a page whose heading is only `Settings`.
- Connections renders for every scope. With the startup admin URL its `This environment` section shows `Network access` plus pairing and client management; with a token from `node apps/server/src/bin.ts pair` it shows `Administrative access` instead. Record which one you saw. The fallback copy proves the scope, not the management UI. Docker sandboxes are a separate surface and out of scope for this map.
- Diagnostics is a route (`/settings/diagnostics`) that is not in the main nav labels. Reach it from General → About → `View diagnostics`; the breadcrumb reads `Diagnostics`. Do not treat it as missing Settings.
- Restore defaults lives on General only and is disabled on a clean home. Do not click it during a verification run unless that is the feature under test; it writes settings on this server.
- Settings search uses `/` as a hint when the box is empty. Typing `/` into a focused composer is a different shortcut. Focus `Search settings` first.

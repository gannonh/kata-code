# Command palette

The command palette is the keyboard overlay for jumping to commands, projects, and threads. On a fresh home it still opens, searches, and can reach Add project and Open settings.

## Sub-features

- `palette-toggle` opens and closes with `mod+k`.
- `palette-root` shows the root search field.
- `palette-settings` runs `Open settings`.
- `palette-add-project` runs `Add project`.
- `palette-miss` shows an empty result for a nonsense query.
- `palette-actions` limits results to actions when the query starts with `>`.

## How to get to it (user POV)

- Press `mod+k` (⌘K on macOS, Ctrl+K elsewhere) while focus is not in the terminal.
- Choose `Add project` on the empty landing, which opens the palette in the add-project flow.

## Driving it with agent-browser

Preconditions:

- Pairing has succeeded.
- `bin/doctor` still passes.
- Focus is not inside a terminal pane.

- **Before.** With the page under the palette visible (empty landing or Settings), save `screenshots/palette-before.png` and `snapshots/palette-before.aria.txt`. The dialog named `Command palette` must be absent.
- **Open.** Press `mod+k`. Run `agent-browser --session katacode-verify press` with `Meta+k` on macOS or `Control+k` elsewhere. A dialog named `Command palette` is present (`data-testid="command-palette"` with `data-palette-mode="command"`; the testid alone is not proof, see Gotchas). The combobox name is `Search commands, projects, and threads...`. Save `screenshots/palette-root.png` and `snapshots/palette-root.aria.txt` while that root palette is open. Do not wait on that placeholder string alone; wait for the dialog name.
- **Open settings.** Type `Open settings` and activate that item. Settings General appears. The palette closes.
- **Reopen.** Press `mod+k` again from General or after `Back`. The root palette returns.
- **Add project.** Type `Add project` and activate it. The palette stays open on Sources (`Local folder`). After `Local folder`, the combobox is named `Enter path (e.g. ~/projects/my-app)` and is prefilled with `~/`. One Escape closes the palette from any add-project view. Do not add a folder unless you are also running the landing recipe.
- **Miss.** Reopen the palette and type `zzzxq-no-such-command`. `Searching thread messages…` may appear first. Wait until the results say `No matching commands, projects, or threads.` and do not include `Open settings`. Close with Escape or `mod+k`.
- **Actions only.** Reopen and type `>zzzxq`. The empty copy is `No matching actions.` instead.
- **Close.** With the palette open, press `mod+k` or Escape. The dialog named `Command palette` is absent.
- **Proof.** Keep the before and open-palette artifacts. `evidence.json` notes `mod+k` as the entry. If `Add project` from the empty landing was used, record that as a second entry, not a substitute for `mod+k`.

## Gotchas

- Default binding is `mod+k` when `terminalFocus` is false. Do not prove this from inside a terminal.
- File picker (`mod+p`) and project content search (`mod+shift+f`) are different overlays (`File picker`, `Search project contents`). The outer dialog still has `data-testid="command-palette"` with `data-palette-mode` `files` or `content`, but the inner panels use `data-testid="project-file-picker"` and `data-testid="project-content-search"`. Prefer those inner testids (or the dialog ARIA name) when distinguishing overlays. Escape from either returns to the root command palette instead of closing; a second Escape closes. A snapshot of those is not command palette proof.
- `Add project` is disabled when no environment is connected. After a correct pair it is enabled. If it is disabled, pairing did not finish. Unpaired, `mod+k` does nothing because the palette is not mounted.
- With more than one environment, or none connected, `Add project` shows an `Environments` group before `Sources`.
- The palette restores focus to the composer on close when a draft or thread is open. The empty landing has no composer, so prove that from `/draft/...`. Wait for the dialog to disappear before taking the next screenshot of the page underneath.
- Message search in the palette needs two characters and existing threads. A fresh home will not show message hits. That is not a failure of `palette-root`.

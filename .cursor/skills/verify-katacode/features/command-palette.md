# Command palette

The command palette is the keyboard overlay for jumping to commands, projects, and threads. On a fresh home it still opens, searches, and can reach Add project and Open settings.

## Sub-features

- `palette-toggle` opens and closes with `mod+k`.
- `palette-root` shows the root search field.
- `palette-settings` runs `Open settings`.
- `palette-add-project` runs `Add project`.
- `palette-miss` shows an empty result for a nonsense query.

## How to get to it (user POV)

- Press `mod+k` (⌘K on macOS, Ctrl+K elsewhere) while focus is not in the terminal.
- Choose `Add project` on the empty landing, which opens the palette in the add-project flow.

## Driving it with agent-browser

Preconditions:

- Pairing has succeeded.
- `bin/doctor` still passes.
- Focus is not inside a terminal pane.

- **Before.** With the page under the palette visible (empty landing or Settings), save `screenshots/palette-before.png` and `snapshots/palette-before.aria.txt`. The dialog named `Command palette` must be absent.
- **Open.** Press `mod+k`. Run `agent-browser --session katacode-verify keyboard` with `Meta+k` on macOS or `Control+k` elsewhere. A dialog named `Command palette` is present (`data-testid="command-palette"`). The text field placeholder is `Search commands, projects, and threads...`. Save `screenshots/palette-root.png` and `snapshots/palette-root.aria.txt` while that root palette is open.
- **Open settings.** Type `Open settings` and activate that item. Settings General appears. The palette closes.
- **Reopen.** Press `mod+k` again from General or after `Back`. The root palette returns.
- **Add project.** Type `Add project` and activate it. The palette stays open on the add-project flow (`Local folder` or the project path placeholder). Press Escape until the palette is gone. Do not add a folder unless you are also running the landing recipe.
- **Miss.** Reopen the palette and type `zzzxq-no-such-command`. The results do not include `Open settings`. Close with Escape or `mod+k`.
- **Close.** With the palette open, press `mod+k` or Escape. The dialog named `Command palette` is absent.
- **Proof.** Keep the before and open-palette artifacts. `evidence.json` notes `mod+k` as the entry. If `Add project` from the empty landing was used, record that as a second entry, not a substitute for `mod+k`.

## Gotchas

- Default binding is `mod+k` when `terminalFocus` is false. Do not prove this from inside a terminal.
- File picker (`mod+p`) and project content search (`mod+shift+f`) are different overlays (`File picker`, `Search project contents`). A snapshot of those is not command palette proof.
- `Add project` is disabled when no environment is connected. After a correct pair it is enabled. If it is disabled, pairing did not finish.
- The palette restores focus to the composer on close. Wait for the dialog to disappear before taking the next screenshot of the page underneath.
- Message search in the palette needs two characters and existing threads. A fresh home will not show message hits. That is not a failure of `palette-root`.
